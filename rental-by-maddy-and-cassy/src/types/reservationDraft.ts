import type { FulfillmentMethod } from "@/src/types/booking";
import type { PaymentOption } from "@/src/types/payment";

export interface EmergencyContactDraft {
  fullName: string;
  relationship: string;
  phone: string;
  facebookLink: string;
  idFile: File | null;
}

export interface RequirementsDraft {
  idOneFile: File | null;
  idTwoFile: File | null;
  selfieFile: File | null;
  facebookLink: string;
  instagramLink: string;
  emergencyContact: EmergencyContactDraft;
}

export interface CustomerInfoDraft {
  fullName: string;
  email: string;
  phone: string;
  /** ISO date (YYYY-MM-DD), used for the optional birthday-month perk. */
  birthDate: string;
  streetBarangay: string;
  cityMunicipality: string;
  province: string;
  /** Composed address retained for booking/profile compatibility. */
  address: string;
  facebookLink: string;
  instagramLink: string;
}

export type SignatureMethod = "drawn" | "uploaded";

export interface AgreementDraft {
  infoAccurate: boolean;
  agreedToTerms: boolean;
  understoodRentalRules: boolean;
  authorizedESignature: boolean;
  readPrivacyNotice: boolean;
  emergencyContactAuthorized: boolean;
  signatureMethod: SignatureMethod;
  signatureDataUrl: string | null;
  signatureFile: File | null;
  typedFullName: string;
}

export interface ReservationDraft {
  /** Number of physical units of the selected product to reserve. */
  quantity: number;
  startDate: Date | null;
  endDate: Date | null;
  /** Last calendar day selected for this rental period. */
  rentalEndDate: Date | null;
  /** Customer-selected pickup time in Asia/Manila, HH:mm. */
  pickupTime: string;
  /** Server-calculated pickup convenience fee for the selected timestamp. */
  pickupConvenienceFee: number;
  fulfillmentMethod: FulfillmentMethod | null;
  /** Street/barangay/landmark line. Only required (and only sent) when fulfillmentMethod is "delivery". */
  customerLocation: string;
  /** Required (and only sent) when fulfillmentMethod is "delivery". */
  cityMunicipality: string;
  /** Required (and only sent) when fulfillmentMethod is "delivery". */
  province: string;
  paymentOption: Exclude<PaymentOption, "balance">;
  customerInfo: CustomerInfoDraft;
  requirements: RequirementsDraft;
  agreement: AgreementDraft;
}

export function createEmptyDraft(): ReservationDraft {
  return {
    quantity: 1,
    startDate: null,
    endDate: null,
    rentalEndDate: null,
    pickupTime: "",
    pickupConvenienceFee: 0,
    fulfillmentMethod: null,
    customerLocation: "",
    cityMunicipality: "",
    province: "",
    paymentOption: "deposit_50",
    customerInfo: {
      fullName: "",
      email: "",
      phone: "",
      birthDate: "",
      streetBarangay: "",
      cityMunicipality: "",
      province: "",
      address: "",
      facebookLink: "",
      instagramLink: "",
    },
    requirements: {
      idOneFile: null,
      idTwoFile: null,
      selfieFile: null,
      facebookLink: "",
      instagramLink: "",
      emergencyContact: {
        fullName: "",
        relationship: "",
        phone: "",
        facebookLink: "",
        idFile: null,
      },
    },
    agreement: {
      infoAccurate: false,
      agreedToTerms: false,
      understoodRentalRules: false,
      authorizedESignature: false,
      readPrivacyNotice: false,
      emergencyContactAuthorized: false,
      signatureMethod: "drawn",
      signatureDataUrl: null,
      signatureFile: null,
      typedFullName: "",
    },
  };
}

export function formatCustomerAddress(
  customerInfo: Pick<CustomerInfoDraft, "streetBarangay" | "cityMunicipality" | "province" | "address">,
): string {
  const structured = [
    customerInfo.streetBarangay,
    customerInfo.cityMunicipality,
    customerInfo.province,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  return structured || customerInfo.address.trim();
}

export function parseCustomerAddress(address: string | null | undefined): Pick<
  CustomerInfoDraft,
  "streetBarangay" | "cityMunicipality" | "province" | "address"
> {
  const normalized = (address ?? "").trim();
  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) {
    return { streetBarangay: normalized, cityMunicipality: "", province: "", address: normalized };
  }
  return {
    streetBarangay: parts.slice(0, -2).join(", "),
    cityMunicipality: parts.at(-2) ?? "",
    province: parts.at(-1) ?? "",
    address: normalized,
  };
}

/**
 * Human-readable location summary used on the review step and the rental
 * agreement. Pickup never carries a delivery address (see create_booking),
 * so it always shows the fixed pickup site instead of blank fields.
 */
export function formatCustomerLocation(
  draft: Pick<ReservationDraft, "fulfillmentMethod" | "customerLocation" | "cityMunicipality" | "province">,
): string {
  if (draft.fulfillmentMethod === "pickup") {
    return "Pickup — Right Focus Off Campus, Manuel Hizon, Sta. Cruz, Manila";
  }
  return [draft.customerLocation, draft.cityMunicipality, draft.province]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function getDayCount(startDate: Date | null, endDate: Date | null): number {
  if (!startDate || !endDate) return 0;
  const elapsedHours = (endDate.getTime() - startDate.getTime()) / (60 * 60 * 1000);
  if (elapsedHours > 0) {
    // A rental day is a 22-hour use period followed by the system's two-hour
    // preparation window. Every additional selected calendar day adds 24 hours.
    return Math.max(1, Math.round((elapsedHours + 2) / 24));
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (new Date(endDate).setHours(0, 0, 0, 0) - new Date(startDate).setHours(0, 0, 0, 0)) / msPerDay
  );
  return diff + 1;
}
