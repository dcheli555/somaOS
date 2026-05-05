import type { Request } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteMedicationForRequest } from "../src/modules/medications/deleteMedication";
import { formatMedicationEtag } from "../src/modules/medications/etag";
import { updateMedicationForRequest } from "../src/modules/medications/putMedication";
import {
  createMedicationsIntegrationApp,
  pool,
  TEST_ACTOR_USER_ID,
} from "./testApp";

const ORG_A = "00000000-0001-4000-8000-000000000001";
const ORG_B = "00000000-0010-4000-8000-000000000010";
const PATIENT_ID = "00000000-0002-4000-8000-000000000002";

function stubPutMedicationRequest(medicationId: string): Request {
  const path = `/api/medications/${medicationId}`;
  const headers = new Map<string, string>([
    ["user-agent", "vitest-integration"],
  ]);
  return {
    method: "PUT",
    originalUrl: path,
    url: path,
    get(header: string) {
      return headers.get(header.toLowerCase()) ?? null;
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

function stubDeleteMedicationRequest(medicationId: string): Request {
  const path = `/api/medications/${medicationId}`;
  const headers = new Map<string, string>([
    ["user-agent", "vitest-integration"],
  ]);
  return {
    method: "DELETE",
    originalUrl: path,
    url: path,
    get(header: string) {
      return headers.get(header.toLowerCase()) ?? null;
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

describe.skipIf(!process.env.DATABASE_URL)(
  "Medications API (integration)",
  () => {
    describe("DB layer (single connection + ROLLBACK)", () => {
      it("PUT: medications + medication_history + audit_log written together", async () => {
        const client = await pool.connect();
        const requestId = randomUUID();

        try {
          await client.query("BEGIN");

          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Seed medication name"],
          );

          const medicationId = seed!.id;
          const req = stubPutMedicationRequest(medicationId);

          const updated = await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId,
            ifMatch: undefined,
            patch: { medication_name: "Updated in transaction test" },
            req,
          });

          expect(updated.medication_name).toBe("Updated in transaction test");

          const {
            rows: [hist],
          } = await client.query<{
            snapshot: { medication_name?: string };
            correlation_request_id: string | null;
          }>(
            `SELECT snapshot, correlation_request_id
             FROM soma_ehr.medication_history
             WHERE medication_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(hist!.snapshot.medication_name).toBe("Seed medication name");
          expect(hist!.correlation_request_id).toBe(requestId);

          const {
            rows: [audit],
          } = await client.query<{
            action: string;
            resource_type: string;
            resource_id: string;
            patient_id: string;
            request_id: string;
            actor_user_id: string;
            context: { domain?: string; requestId?: string };
          }>(
            `SELECT action, resource_type, resource_id, patient_id, request_id, actor_user_id, context
             FROM soma_ehr.audit_log
             WHERE resource_id = $1
             ORDER BY recorded_at DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(audit!.action).toBe("update");
          expect(audit!.resource_type).toBe("medication");
          expect(audit!.resource_id).toBe(medicationId);
          expect(audit!.patient_id).toBe(PATIENT_ID);
          expect(audit!.request_id).toBe(requestId);
          expect(audit!.actor_user_id).toBe(TEST_ACTOR_USER_ID);
          expect(audit!.context.domain).toBe("medications.put");
          expect(audit!.context.requestId).toBe(requestId);

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("PUT rejects wrong If-Match (IF_MATCH_FAILED)", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id`,
            [ORG_A, PATIENT_ID, "If-match seed"],
          );
          const medicationId = seed!.id;

          await expect(
            updateMedicationForRequest(client, {
              medicationId,
              organizationId: ORG_A,
              actorUserId: TEST_ACTOR_USER_ID,
              requestId: randomUUID(),
              ifMatch: '"1"',
              patch: { medication_name: "Should not apply" },
              req: stubPutMedicationRequest(medicationId),
            }),
          ).rejects.toMatchObject({ code: "IF_MATCH_FAILED" });

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("PUT succeeds when If-Match matches updated_at", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const {
            rows: [seed],
          } = await client.query<{ id: string; updated_at: Date }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id, updated_at`,
            [ORG_A, PATIENT_ID, "Etag PUT ok"],
          );
          const medicationId = seed!.id;
          const etag = formatMedicationEtag(seed!.updated_at);

          const updated = await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId: randomUUID(),
            ifMatch: etag,
            patch: { dose_text: "5mg" },
            req: stubPutMedicationRequest(medicationId),
          });

          expect(updated.dose_text).toBe("5mg");

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("DELETE rejects when medication_history exists", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Delete blocked seed"],
          );
          const medicationId = seed!.id;

          await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId: randomUUID(),
            ifMatch: undefined,
            patch: { medication_name: "Second version" },
            req: stubPutMedicationRequest(medicationId),
          });

          await expect(
            deleteMedicationForRequest(client, {
              medicationId,
              organizationId: ORG_A,
              actorUserId: TEST_ACTOR_USER_ID,
              requestId: randomUUID(),
              ifMatch: undefined,
              req: stubDeleteMedicationRequest(medicationId),
            }),
          ).rejects.toMatchObject({ code: "MEDICATION_HAS_HISTORY" });

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

      describe("with a seeded medication", () => {
        let medicationId: string;

        beforeEach(async () => {
          const {
            rows: [row],
          } = await pool.query<{ id: string }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id`,
            [ORG_A, PATIENT_ID, "HTTP seed name"],
          );
          medicationId = row!.id;
        });

        afterEach(async () => {
          await pool.query(`DELETE FROM soma_ehr.medications WHERE id = $1`, [
            medicationId,
          ]);
        });

        it("PUT returns 403 when X-Organization-Id does not match", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_B)
            .send({ medication_name: "Should not apply" });

          expect(res.status).toBe(403);

          const { rows: hist } = await pool.query(
            `SELECT 1 FROM soma_ehr.medication_history WHERE medication_id = $1`,
            [medicationId],
          );
          expect(hist.length).toBe(0);

          const { rows: meds } = await pool.query<{ medication_name: string }>(
            `SELECT medication_name FROM soma_ehr.medications WHERE id = $1`,
            [medicationId],
          );
          expect(meds[0]!.medication_name).toBe("HTTP seed name");
        });

        it("PUT returns 412 when If-Match is wrong", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", '"0"')
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(412);

          const { rows: meds } = await pool.query<{ medication_name: string }>(
            `SELECT medication_name FROM soma_ehr.medications WHERE id = $1`,
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
          .send({ medication_name: "Nope" });

        expect(res.status).toBe(404);
      });

      it("POST creates a medication and audit row; responds with ETag and Location", async () => {
        const res = await request(app)
          .post("/api/medications")
          .set("X-Organization-Id", ORG_A)
          .send({
            patient_id: PATIENT_ID,
            medication_name: "Created via POST",
          });

        expect(res.status).toBe(201);
        expect(res.body.medication_name).toBe("Created via POST");
        const id = res.body.id as string;
        expect(res.headers.etag).toMatch(/^"\d+"$/);
        expect(res.headers.location).toBe(`/api/medications/${id}`);

        const {
          rows: [audit],
        } = await pool.query<{ action: string; context: { domain?: string } }>(
          `SELECT action, context FROM soma_ehr.audit_log
           WHERE resource_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
          [id],
        );
        expect(audit!.action).toBe("create");
        expect(audit!.context.domain).toBe("medications.post");

        const del = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A);
        expect(del.status).toBe(204);
      });

      it("DELETE returns 412 when If-Match wrong, then succeeds without header", async () => {
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
          .set("If-Match", '"0"');
        expect(bad.status).toBe(412);

        const ok = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A);
        expect(ok.status).toBe(204);
      });
    });
  },
);
