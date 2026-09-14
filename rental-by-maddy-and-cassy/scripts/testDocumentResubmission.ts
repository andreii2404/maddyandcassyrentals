import assert from "node:assert/strict";
import test from "node:test";
import { mapRequirementToDocument } from "../src/services/bookingDetailService";

test("the admin document model uses the latest submission and exposes resubmission metadata", () => {
  const requirement = {
    id: "requirement-1",
    booking_id: "booking-1",
    document_type_snapshot: "government_id",
    requirement_key_snapshot: "government_id",
    created_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-12T09:00:00.000Z",
    booking_requirement_submissions: [
      {
        id: "submission-rejected",
        attempt_number: 1,
        review_status: "rejected",
        review_notes: "The image is blurry.",
        reviewed_by: "admin-1",
        reviewed_at: "2026-09-11T08:00:00.000Z",
        submitted_at: "2026-09-10T08:00:00.000Z",
        customer_documents: {
          document_type: "government_id",
          storage_bucket: "booking-documents",
          storage_path: "old/rejected.pdf",
          original_filename: "old-id.pdf",
          mime_type: "application/pdf",
          file_size_bytes: 100,
          created_at: "2026-09-10T08:00:00.000Z",
          updated_at: "2026-09-10T08:00:00.000Z",
        },
      },
      {
        id: "submission-resubmitted",
        attempt_number: 2,
        review_status: "pending",
        review_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        submitted_at: "2026-09-12T09:00:00.000Z",
        customer_documents: {
          document_type: "government_id",
          storage_bucket: "booking-documents",
          storage_path: "new/resubmitted.pdf",
          original_filename: "new-id.pdf",
          mime_type: "application/pdf",
          file_size_bytes: 200,
          created_at: "2026-09-12T09:00:00.000Z",
          updated_at: "2026-09-12T09:00:00.000Z",
        },
      },
    ],
  } as Parameters<typeof mapRequirementToDocument>[0];

  const document = mapRequirementToDocument(requirement);

  assert.equal(document?.id, "submission-resubmitted");
  assert.equal(document?.storagePath, "new/resubmitted.pdf");
  assert.equal(document?.reviewStatus, "pending");
  assert.equal((document as unknown as { attemptNumber: number }).attemptNumber, 2);
  assert.equal((document as unknown as { submittedAt: string }).submittedAt, "2026-09-12T09:00:00.000Z");
  assert.equal((document as unknown as { isResubmitted: boolean }).isResubmitted, true);
});
