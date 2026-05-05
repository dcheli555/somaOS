import type { Request } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteMedicationForRequest } from "../src/modules/medications/deleteMedication";
import { toEtag } from "../src/modules/medications/etag";
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
            expectedVersion: 1,
            patch: { medication_name: "Updated in transaction test" },
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
          }>(
            `SELECT snapshot, correlation_request_id
             FROM soma_ehr.medication_history
             WHERE medication_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(hist!.snapshot.medication_name).toBe("Seed medication name");
          expect(hist!.snapshot.version).toBe(1);
          expect(hist!.correlation_request_id).toBe(requestId);

          const {
            rows: [audit],
          } = await client.query<{
            action: string;
            resource_type: string;
            resource_id: string;
          }>(
            `SELECT action, resource_type, resource_id
             FROM soma_ehr.audit_log
             WHERE resource_id = $1
             ORDER BY recorded_at DESC
             LIMIT 1`,
            [medicationId],
          );
          expect(audit!.action).toBe("update");

          await client.query("ROLLBACK");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          client.release();
        }
      });

      it("PUT rejects stale expectedVersion (PRECONDITION_FAILED)", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Version stale seed"],
          );
          const medicationId = seed!.id;

          await expect(
            updateMedicationForRequest(client, {
              medicationId,
              organizationId: ORG_A,
              actorUserId: TEST_ACTOR_USER_ID,
              requestId: randomUUID(),
              expectedVersion: 99,
              patch: { medication_name: "Should not apply" },
              req: stubPutMedicationRequest(medicationId),
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

      it("PUT succeeds when expectedVersion matches current row", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const {
            rows: [seed],
          } = await client.query<{ id: string }>(
            `INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status)
             VALUES ($1, $2, $3, 'active')
             RETURNING id`,
            [ORG_A, PATIENT_ID, "Etag PUT ok"],
          );
          const medicationId = seed!.id;

          const updated = await updateMedicationForRequest(client, {
            medicationId,
            organizationId: ORG_A,
            actorUserId: TEST_ACTOR_USER_ID,
            requestId: randomUUID(),
            expectedVersion: 1,
            patch: { dose_text: "5mg" },
            req: stubPutMedicationRequest(medicationId),
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
            expectedVersion: 1,
            patch: { medication_name: "Second version" },
            req: stubPutMedicationRequest(medicationId),
          });

          await expect(
            deleteMedicationForRequest(client, {
              medicationId,
              organizationId: ORG_A,
              actorUserId: TEST_ACTOR_USER_ID,
              requestId: randomUUID(),
              expectedVersion: 2,
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

        it("GET returns JSON with version and ETag from version (not updated_at millis)", async () => {
          const res = await request(app)
            .get(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A);

          expect(res.status).toBe(200);
          expect(res.body.version).toBe(1);
          expect(res.headers.etag).toBe(toEtag(1));
          expect(res.headers.etag).not.toMatch(/^"\d{10,}"$/);
        });

        it("PUT returns 403 when X-Organization-Id does not match", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_B)
            .set("If-Match", toEtag(1))
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

        it("PUT returns 428 without If-Match", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(428);
          expect(res.body.error.code).toBe("PRECONDITION_REQUIRED");
          expect(res.body.error.requestId).toBeTruthy();
        });

        it("PUT returns 400 for malformed If-Match", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", "not-an-etag")
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(400);
          expect(res.body.error.code).toBe("IF_MATCH_INVALID");
        });

        it("PUT returns 412 when If-Match version is stale", async () => {
          const res = await request(app)
            .put(`/api/medications/${medicationId}`)
            .set("X-Organization-Id", ORG_A)
            .set("If-Match", toEtag(2))
            .send({ medication_name: "Nope" });

          expect(res.status).toBe(412);
          expect(res.body.error.code).toBe("PRECONDITION_FAILED");

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
          .set("If-Match", toEtag(1))
          .send({ medication_name: "Nope" });

        expect(res.status).toBe(404);
      });

      it("HTTP PUT with matching If-Match returns updated body and new ETag", async () => {
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
          .send({ medication_name: "Concurrency HTTP v2" });

        expect(put.status).toBe(200);
        expect(put.body.version).toBe(2);
        expect(put.headers.etag).toBe(toEtag(2));
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
        } = await pool.query<{ action: string; context: { domain?: string } }>(
          `SELECT action, context FROM soma_ehr.audit_log
           WHERE resource_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
          [id],
        );
        expect(audit!.action).toBe("create");

        const del = await request(app)
          .delete(`/api/medications/${id}`)
          .set("X-Organization-Id", ORG_A)
          .set("If-Match", toEtag(1));
        expect(del.status).toBe(204);
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
      });
    });
  },
);
