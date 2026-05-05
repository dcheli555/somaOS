import type { Request } from "express";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
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

describe.skipIf(!process.env.DATABASE_URL)(
  "PUT /api/medications/:id (integration)",
  () => {
    describe("updateMedicationForRequest (transaction rollback)", () => {
      it("writes medications row, medication_history snapshot, and audit_log in one transaction", async () => {
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

        it("returns 403 when X-Organization-Id does not match the medication row", async () => {
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
      });

      it("returns 404 when medication id does not exist", async () => {
        const fakeId = "aaaaaaaa-bbbb-4ccc-bddd-eeeeeeeeeeee";
        const res = await request(app)
          .put(`/api/medications/${fakeId}`)
          .set("X-Organization-Id", ORG_A)
          .send({ medication_name: "Nope" });

        expect(res.status).toBe(404);
      });
    });
  },
);
