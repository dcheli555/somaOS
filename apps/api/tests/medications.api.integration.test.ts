import type { Request } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { deleteMedicationForRequest } from "../src/modules/medications/deleteMedication";
import { toEtag } from "../src/modules/medications/etag";
import {
  updateMedicationForRequest,
  type MedicationFullReplaceBody,
} from "../src/modules/medications/putMedication";
import {
  createMedicationsIntegrationApp,
  pool,
  TEST_ACTOR_USER_ID,
} from "./testApp";

const ORG_A = "00000000-0001-4000-8000-000000000001";
const ORG_B = "00000000-0010-4000-8000-000000000010";
const PATIENT_ID = "00000000-0002-4000-8000-000000000002";

/** Hard-delete a medication row in tests (append-only trigger would block CASCADE otherwise). */
async function purgeMedicationRowForTest(medicationId: string): Promise<void> {
  await pool.query(
    `ALTER TABLE soma_os.medication_history DISABLE TRIGGER trg_medication_history_prevent_delete`,
  );
  try {
    await pool.query(`DELETE FROM soma_os.medications WHERE id = $1`, [
      medicationId,
    ]);
  } finally {
    await pool.query(
      `ALTER TABLE soma_os.medication_history ENABLE TRIGGER trg_medication_history_prevent_delete`,
    );
  }
}

/** Mirrors production request context shape for DB-layer audit tests (`legacy:<uuid>` matches seeded rows). */
function stubLegacyClerkOrgBinding(internalOrganizationId: string): string {
  return `legacy:${internalOrganizationId}`;
}

function fullMedicationReplaceForSeed(
  medicationName = "HTTP seed name",
): MedicationFullReplaceBody {
  return {
    medication_name: medicationName,
    rxnorm_cui: null,
    ndc_10: null,
    ndc_11: null,
    dose_text: null,
    route: null,
    form: null,
    strength: null,
    frequency_text: null,
    sig_text: null,
    status: "active",
    start_at: null,
    end_at: null,
    metadata: {},
  };
}

function stubMedicationTxRequest(init: {
  medicationId: string;
  method: "PATCH" | "PUT" | "DELETE";
  organizationId?: string;
  clerkOrganizationId?: string;
  requestId: string;
  correlationId?: string;
}): Request {
  const path = `/api/medications/${init.medicationId}`;
  const organizationId = init.organizationId ?? ORG_A;
  const correlationId = init.correlationId ?? randomUUID();
  const headers = new Map<string, string>([
    ["user-agent", "vitest-integration"],
  ]);
  return {
    method: init.method,
    originalUrl: path,
    url: path,
    get(header: string) {
      return headers.get(header.toLowerCase()) ?? null;
    },
    socket: { remoteAddress: "127.0.0.1" },
    context: {
      correlationId,
      requestId: init.requestId,
      timestamp: new Date().toISOString(),
      organizationId,
      clerkOrganizationId:
        init.clerkOrganizationId ?? stubLegacyClerkOrgBinding(organizationId),
    },
    authContext: { userId: TEST_ACTOR_USER_ID },
  } as unknown as Request;
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Medications API (integration)",
  () => {
    describe("DB layer (single connection + ROLLBACK)", () => {
      it("PATCH (DB): medications + medication_history + audit_log written together", async () => {
        const client = await pool.connect();
        const requestId = randomUUID();

        try {
          await client.query("BEGIN");

          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_os.medications (organization_id, patient_id, medication_name, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'active', $4, $4)
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Seed medication name", TEST_ACTOR_USER_ID],
          );

          const medicationId = seed!.id;
          const correlationId = randomUUID();
          const req = stubMedicationTxRequest({
            medicationId,
            method: "PATCH",
            organizationId: ORG_A,
            requestId,
            correlationId,
          });

          const updated = await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId,
            expectedVersion: 1,
            patch: { medication_name: "Updated in transaction test" },
            auditMetadataDomain: "medications.patch",
            req,
          });

          expect(updated.medication_name).toBe("Updated in transaction test");
          expect(updated.version).toBe(2);
          expect(toEtag(updated.version)).toBe('"v2"');

          const {
            rows: [hist],
          } = await client.query<{
            snapshot: { medication_name?: string; version?: number };
            correlation_request_id: string | null;
            prior_version: number | null;
            change_type: string;
            encounter_id: string | null;
          }>(
            `SELECT snapshot, correlation_request_id, prior_version, change_type, encounter_id
             FROM soma_os.medication_history
             WHERE medication_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(hist!.snapshot.medication_name).toBe("Seed medication name");
          expect(hist!.snapshot.version).toBe(1);
          expect(hist!.prior_version).toBe(1);
          expect(hist!.change_type).toBe("update");
          expect(hist!.encounter_id).toBeNull();
          expect(hist!.correlation_request_id).toBe(requestId);

          const {
            rows: [audit],
          } = await client.query<{
            action: string;
            resource_type: string;
            resource_id: string;
            outcome: string;
            event_type: string;
            correlation_id: string;
            request_id: string;
            organization_id: string | null;
            actor_user_id: string | null;
          }>(
            `SELECT action, resource_type, resource_id, outcome, event_type,
                    correlation_id, request_id, organization_id, actor_user_id
             FROM soma_os.audit_log
             WHERE resource_id = $1
             ORDER BY "timestamp" DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(audit!.action).toBe("update");
          expect(audit!.outcome).toBe("success");
          expect(audit!.event_type).toBe("medication.update");
          expect(audit!.correlation_id).toBe(correlationId);
          expect(audit!.request_id).toBe(requestId);
          expect(audit!.organization_id).toBe(ORG_A);
          expect(audit!.actor_user_id).toBe(TEST_ACTOR_USER_ID);

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("PATCH rejects stale expectedVersion (PRECONDITION_FAILED)", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_os.medications (organization_id, patient_id, medication_name, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'active', $4, $4)
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Version stale seed", TEST_ACTOR_USER_ID],
          );
          const medicationId = seed!.id;
          const rid = randomUUID();

          await expect(
            updateMedicationForRequest(client, {
              medicationId,
              organizationId: ORG_A,
              actorUserId: TEST_ACTOR_USER_ID,
              requestId: rid,
              expectedVersion: 99,
              patch: { medication_name: "Should not apply" },
              auditMetadataDomain: "medications.patch",
              req: stubMedicationTxRequest({
                medicationId,
                method: "PATCH",
                requestId: rid,
              }),
            }),
          ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("PATCH succeeds when expectedVersion matches current row", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_os.medications (organization_id, patient_id, medication_name, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'active', $4, $4)
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Etag PUT ok", TEST_ACTOR_USER_ID],
          );
          const medicationId = seed!.id;
          const rid = randomUUID();

          const updated = await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId: rid,
            expectedVersion: 1,
            patch: { dose_text: "5mg" },
            auditMetadataDomain: "medications.patch",
            req: stubMedicationTxRequest({
              medicationId,
              method: "PATCH",
              requestId: rid,
            }),
          });

          expect(updated.dose_text).toBe("5mg");
          expect(updated.version).toBe(2);

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("DELETE after PATCH appends delete history and soft-deletes", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_os.medications (organization_id, patient_id, medication_name, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'active', $4, $4)
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Delete soft seed", TEST_ACTOR_USER_ID],
          );
          const medicationId = seed!.id;
          const putRid = randomUUID();
          const delRid = randomUUID();

          await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId: putRid,
            expectedVersion: 1,
            patch: { medication_name: "Second version" },
            auditMetadataDomain: "medications.patch",
            req: stubMedicationTxRequest({
              medicationId,
              method: "PATCH",
              requestId: putRid,
            }),
          });

          const deleted = await deleteMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId: delRid,
            expectedVersion: 2,
            req: stubMedicationTxRequest({
              medicationId,
              method: "DELETE",
              requestId: delRid,
            }),
          });

          expect(deleted.deleted_at).not.toBeNull();
          expect(deleted.version).toBe(3);

          const { rows: histRows } = await client.query<{
            prior_version: number | null;
            change_type: string;
          }>(
            `SELECT prior_version, change_type
             FROM soma_os.medication_history
             WHERE medication_id = $1
             ORDER BY created_at ASC,
               CASE change_type
                 WHEN 'create' THEN 0
                 WHEN 'update' THEN 1
                 WHEN 'delete' THEN 2
                 WHEN 'restore' THEN 3
                 ELSE 4
               END`,
            [medicationId],
          );
          expect(histRows).toHaveLength(2);
          expect(histRows[0]!.change_type).toBe("update");
          expect(histRows[0]!.prior_version).toBe(1);
          expect(histRows[1]!.change_type).toBe("delete");
          expect(histRows[1]!.prior_version).toBe(2);

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });
    });

    describe("HTTP (stub auth)", () => {
      const app = createMedicationsIntegrationApp();

      /** HTTP stack resolves tenants via DB; pins rows even if migrations predate org seeds. */
      beforeAll(async () => {
        await pool.query(
          `INSERT INTO soma_os.organizations (id, clerk_organization_id, name)
           VALUES ($1::uuid, $2, 'Integration tenant A'),
                  ($3::uuid, $4, 'Integration tenant B')
           ON CONFLICT (id) DO NOTHING`,
          [
            ORG_A,
            `legacy:${ORG_A}`,
            ORG_B,
            `legacy:${ORG_B}`,
          ],
        );
      });

      describe("with a seeded medication", () => {
        let medicationId: string;

        beforeEach(async () => {
          const {
            rows: [row],
          } = await pool.query<{ id: string }>(
            `INSERT INTO soma_os.medications (organization_id, patient_id, medication_name, status, created_by, updated_by)
             VALUES ($1, $2, $3, 'active', $4, $4)
             RETURNING id`,
            [ORG_A, PATIENT_ID, "HTTP seed name", TEST_ACTOR_USER_ID],
          );
          medicationId = row!.id;
        });

        afterEach(async () => {
          await purgeMedicationRowForTest(medicationId);
        });

        it("GET returns JSON with version and ETag from version (not updated_at millis)", async () => {
          const res = await request(app)
            .get(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A);

          expect(res.status).toBe(200);
          expect(res.body.version).toBe(1);
          expect(res.headers.etag).toBe(toEtag(1));
          expect(res.headers.etag).not.toMatch(/^"\d{10,}"$/);

          const {
            rows: [audit],
          } = await pool.query<{
            event_type: string;
            action: string;
            outcome: string;
            resource_type: string;
            resource_id: string;
            patient_id: string | null;
            organization_id: string | null;
            actor_user_id: string | null;
            request_id: string;
          }>(
            `SELECT event_type, action, outcome, resource_type, resource_id, patient_id,
                    organization_id, actor_user_id, request_id
             FROM soma_os.audit_log
             WHERE resource_id = $1 AND event_type = 'medication.view'
             ORDER BY "timestamp" DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(audit).toBeDefined();
          expect(audit!.event_type).toBe("medication.view");
          expect(audit!.action).toBe("view");
          expect(audit!.outcome).toBe("success");
          expect(audit!.resource_type).toBe("MedicationStatement");
          expect(audit!.patient_id).toBe(PATIENT_ID);
          expect(audit!.organization_id).toBe(ORG_A);
          expect(audit!.actor_user_id).toBe(TEST_ACTOR_USER_ID);
          expect(audit!.request_id).toBeTruthy();

          const { rows: hist } = await pool.query(
            `SELECT 1 FROM soma_os.medication_history WHERE medication_id = $1`,
            [medicationId],
          );
          expect(hist.length).toBe(0);
        });

        it("PATCH returns 403 when X-Organization-Id does not match", async () => {
          const res = await request(app)
            .patch(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_B)
            .set("If-Match", toEtag(1))
            .send({ medication_name: "Should not apply" });

          expect(res.status).toBe(403);

          const { rows: hist } = await pool.query(
            `SELECT 1 FROM soma_os.medication_history WHERE medication_id = $1`,
            [medicationId],
          );
          expect(hist.length).toBe(0);

          const { rows: meds } = await pool.query<{ medication_name: string }>(
            `SELECT medication_name FROM soma_os.medications WHERE id = $1`,
            [medicationId],
          );
          expect(meds[0]!.medication_name).toBe("HTTP seed name");
        });

        it("PATCH returns 428 without If-Match", async () => {
          const res = await request(app)
            .patch(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(428);
          expect(res.body.error.code).toBe("PRECONDITION_REQUIRED");
          expect(res.body.error.requestId).toBeTruthy();
        });

        it("PUT returns 428 without If-Match (requires full replacement body)", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .send(fullMedicationReplaceForSeed("Full body no etag"));

          expect(res.status).toBe(428);
          expect(res.body.error.code).toBe("PRECONDITION_REQUIRED");
        });

        it("PUT returns INVALID_BODY when body omits mutable fields (partial shape)", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", toEtag(1))
            .send({ medication_name: "Only partial — use PATCH" });

          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe("INVALID_BODY");
        });

        it("PATCH returns 400 EMPTY_PATCH for empty object body", async () => {
          const res = await request(app)
            .patch(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", toEtag(1))
            .send({});

          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe("EMPTY_PATCH");
        });

        it("PATCH returns 400 for malformed If-Match", async () => {
          const res = await request(app)
            .patch(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", "not-an-etag")
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe("IF_MATCH_INVALID");
        });

        it("PATCH returns 412 when If-Match version is stale", async () => {
          const res = await request(app)
            .patch(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", toEtag(2))
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(412);
          expect(res.body.error.code).toBe("PRECONDITION_FAILED");

          const { rows: meds } = await pool.query<{ medication_name: string }>(
            `SELECT medication_name FROM soma_os.medications WHERE id = $1`,
            [medicationId],
          );
          expect(meds[0]!.medication_name).toBe("HTTP seed name");
        });
      });

      it("PUT returns 404 when medication id does not exist", async () => {
        const fakeId = "aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee";
        const res = await request(app)
          .put(`/api/medications/${fakeId}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1))
          .send(fullMedicationReplaceForSeed("Nobody"));

        expect(res.status).toBe(404);
      });

      it("HTTP PUT replaces full resource when If-Match matches", async () => {
        const post = await request(app)
          .post("/api/medications")
          .set("X-Organization-Id", ORG_A)
          .send({
            patient_id: PATIENT_ID,
            medication_name: "Concurrency HTTP",
          });
        expect(post.status).toBe(201);
        expect(post.headers.etag).toBe(toEtag(1));

        const id = post.body.id as string;
        const put = await request(app)
          .put(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1))
          .send(fullMedicationReplaceForSeed("Concurrency HTTP v2"));

        expect(put.status).toBe(200);
        expect(put.body.version).toBe(2);
        expect(put.headers.etag).toBe(toEtag(2));
        expect(put.body.medication_name).toBe("Concurrency HTTP v2");

        const {
          rows: [audit],
        } = await pool.query<{ metadata: { domain?: string } | null }>(
          `SELECT metadata FROM soma_os.audit_log
           WHERE resource_id = $1 AND event_type = 'medication.update'
           ORDER BY "timestamp" DESC LIMIT 1`,
          [id],
        );
        expect(audit!.metadata?.domain).toBe("medications.put");

        await purgeMedicationRowForTest(id);
      });

      it("HTTP PATCH updates only supplied fields", async () => {
        const post = await request(app)
          .post("/api/medications")
          .set("X-Organization-Id", ORG_A)
          .send({
            patient_id: PATIENT_ID,
            medication_name: "Patch subset",
          });
        expect(post.status).toBe(201);
        const id = post.body.id as string;

        const patchRes = await request(app)
          .patch(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1))
          .send({ dose_text: "20mg", rxnorm_cui: "429503" });

        expect(patchRes.status).toBe(200);
        expect(patchRes.body.medication_name).toBe("Patch subset");
        expect(patchRes.body.dose_text).toBe("20mg");
        expect(patchRes.body.rxnorm_cui).toBe("429503");
        expect(patchRes.body.version).toBe(2);

        const {
          rows: [audit],
        } = await pool.query<{ metadata: { domain?: string } | null }>(
          `SELECT metadata FROM soma_os.audit_log
           WHERE resource_id = $1 AND event_type = 'medication.update'
           ORDER BY "timestamp" DESC LIMIT 1`,
          [id],
        );
        expect(audit!.metadata?.domain).toBe("medications.patch");

        await purgeMedicationRowForTest(id);
      });

      it("POST returns ETag v1 tied to row version", async () => {
        const res = await request(app)
          .post("/api/medications")
          .set("X-Organization-Id", ORG_A)
          .send({
            patient_id: PATIENT_ID,
            medication_name: "Created via POST",
          });

        expect(res.status).toBe(201);
        expect(res.body.version).toBe(1);
        expect(res.headers.etag).toBe(toEtag(1));

        const id = res.body.id as string;

        const {
          rows: [audit],
        } = await pool.query<{
          action: string;
          outcome: string;
          event_type: string;
          metadata: { domain?: string } | null;
        }>(
          `SELECT action, outcome, event_type, metadata FROM soma_os.audit_log
           WHERE resource_id = $1 ORDER BY "timestamp" DESC LIMIT 1`,
          [id],
        );
        expect(audit!.action).toBe("create");
        expect(audit!.outcome).toBe("success");
        expect(audit!.event_type).toBe("medication.create");

        const del = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1));
        expect(del.status).toBe(204);

        await purgeMedicationRowForTest(id);
      });

      it("DELETE returns 428 without If-Match", async () => {
        const post = await request(app)
          .post("/api/medications")
          .set("X-Organization-Id", ORG_A)
          .send({
            patient_id: PATIENT_ID,
            medication_name: "Needs if-match delete",
          });
        expect(post.status).toBe(201);
        const id = post.body.id as string;

        const res = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A);

        expect(res.status).toBe(428);
        expect(res.body.error.code).toBe("PRECONDITION_REQUIRED");

        const cleanup = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1));
        expect(cleanup.status).toBe(204);

        await purgeMedicationRowForTest(id);
      });

      it("DELETE returns 412 when If-Match version stale, then succeeds", async () => {
        const post = await request(app)
          .post("/api/medications")
          .set("X-Organization-Id", ORG_A)
          .send({
            patient_id: PATIENT_ID,
            medication_name: "Delete if-match",
          });
        expect(post.status).toBe(201);
        const id = post.body.id as string;

        const bad = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(2));
        expect(bad.status).toBe(412);
        expect(bad.body.error.code).toBe("PRECONDITION_FAILED");

        const ok = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1));
        expect(ok.status).toBe(204);

        await purgeMedicationRowForTest(id);
      });
    });
  },
);
