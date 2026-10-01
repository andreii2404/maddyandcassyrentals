import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEmergencyContactPersistencePayload,
  hasFreshDocumentSlots,
  selectLatestEligibleEmergencyContact,
  selectReusableVerificationDocuments,
} from "../src/lib/customerReservationPrefill";

test("emergency contact persistence keeps the submitted Facebook link", () => {
  assert.deepEqual(
    buildEmergencyContactPersistencePayload("booking-1", {
      idDocumentId: "document-1",
      fullName: "Jane Customer",
      relationship: "Sibling",
      phone: "09171234567",
      facebookLink: "https://facebook.com/jane.customer",
    }),
    {
      booking_id: "booking-1",
      full_name: "Jane Customer",
      relationship: "Sibling",
      phone_number: "09171234567",
      facebook_link: "https://facebook.com/jane.customer",
      id_document_id: "document-1",
      address: "",
    },
  );
});

test("latest eligible booking contact ignores cancelled and rejected bookings", () => {
  const result = selectLatestEligibleEmergencyContact([
    {
      status: "cancelled",
      createdAt: "2026-09-30T10:00:00.000Z",
      emergencyContact: { fullName: "Cancelled", relationship: "Sibling", phone: "09170000000", facebookLink: "" },
    },
    {
      status: "rejected",
      createdAt: "2026-09-29T10:00:00.000Z",
      emergencyContact: { fullName: "Rejected", relationship: "Sibling", phone: "09170000001", facebookLink: "" },
    },
    {
      status: "returned",
      createdAt: "2026-09-28T10:00:00.000Z",
      emergencyContact: { fullName: "Latest Valid", relationship: "Parent", phone: "09170000002", facebookLink: "https://facebook.com/parent" },
    },
  ]);

  assert.equal(result?.fullName, "Latest Valid");
  assert.equal(result?.facebookLink, "https://facebook.com/parent");
});

test("reusable documents require active status, no expiry, and an approved submission", () => {
  const documents = selectReusableVerificationDocuments(
    [
      { id: "valid", documentType: "authorization_letter", status: "active", expiresAt: null, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "expired", documentType: "authorization_letter", status: "active", expiresAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-02T00:00:00.000Z" },
      { id: "inactive", documentType: "authorization_letter", status: "replaced", expiresAt: null, createdAt: "2026-09-03T00:00:00.000Z" },
      { id: "unapproved", documentType: "authorization_letter", status: "active", expiresAt: null, createdAt: "2026-09-04T00:00:00.000Z" },
    ],
    new Set(["valid"]),
    new Date("2026-10-01T00:00:00.000Z"),
  );

  assert.deepEqual(documents.map((document) => document.id), ["valid"]);
});

test("all verified documents can be reused without a fresh-document insert", () => {
  assert.equal(hasFreshDocumentSlots([]), false);
  assert.equal(hasFreshDocumentSlots(["idOne"]), true);
});
