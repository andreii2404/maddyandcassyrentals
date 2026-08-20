import {
  createEmptyDraft,
  type CustomerInfoDraft,
  type ReservationDraft,
} from "@/src/types/reservationDraft";
import type { BookingPaymentState } from "@/components/reservation/StepPaymentSubmission";

const STORAGE_VERSION = 2;
export const RESERVATION_PROGRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredReservationProgress {
  version: number;
  savedAt: number;
  step: number;
  bookingId: string | null;
  bookingNumber: string | null;
  paymentState: BookingPaymentState;
  isDemoPayment: boolean;
  draft: {
    quantity: number;
    startDate: string | null;
    endDate: string | null;
    rentalEndDate?: string | null;
    pickupTime: string;
    pickupConvenienceFee: number;
    fulfillmentMethod: ReservationDraft["fulfillmentMethod"];
    customerLocation: string;
    cityMunicipality: string;
    province: string;
    paymentOption: ReservationDraft["paymentOption"];
    customerInfo: CustomerInfoDraft;
    manualPayment: {
      referenceNumber: string;
      accountName: string;
      accountNumber: string;
    };
    requirements: {
      facebookLink: string;
      instagramLink: string;
      emergencyContact: {
        fullName: string;
        relationship: string;
        phone: string;
        facebookLink: string;
      };
    };
    agreement: Omit<ReservationDraft["agreement"], "signatureDataUrl" | "signatureFile">;
  };
}

export interface RestoredReservationProgress {
  savedAt: number;
  step: number;
  bookingId: string | null;
  bookingNumber: string | null;
  paymentState: BookingPaymentState;
  isDemoPayment: boolean;
  draft: ReservationDraft;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function date(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function paymentState(value: unknown): BookingPaymentState {
  return ["unpaid", "pending", "partially_paid", "paid"].includes(String(value))
    ? (value as BookingPaymentState)
    : "unpaid";
}

export function reservationProgressKey(userId: string, productId: string): string {
  return `maddy-cassy-reservation:${userId}:${productId}`;
}

export function serializeReservationProgress(input: {
  draft: ReservationDraft;
  step: number;
  bookingId: string | null;
  bookingNumber: string | null;
  paymentState: BookingPaymentState;
  isDemoPayment: boolean;
  savedAt?: number;
}): string {
  const stored: StoredReservationProgress = {
    version: STORAGE_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    step: Math.min(6, Math.max(1, Math.floor(input.step || 1))),
    bookingId: input.bookingId,
    bookingNumber: input.bookingNumber,
    paymentState: input.paymentState,
    isDemoPayment: input.isDemoPayment,
    draft: {
      quantity: input.draft.quantity,
      startDate: input.draft.startDate?.toISOString() ?? null,
      endDate: input.draft.endDate?.toISOString() ?? null,
      rentalEndDate: input.draft.rentalEndDate?.toISOString() ?? null,
      pickupTime: input.draft.pickupTime,
      pickupConvenienceFee: input.draft.pickupConvenienceFee,
      fulfillmentMethod: input.draft.fulfillmentMethod,
      customerLocation: input.draft.customerLocation,
      cityMunicipality: input.draft.cityMunicipality,
      province: input.draft.province,
      paymentOption: input.draft.paymentOption,
      customerInfo: input.draft.customerInfo,
      manualPayment: {
        referenceNumber: input.draft.manualPayment.referenceNumber,
        accountName: input.draft.manualPayment.accountName,
        accountNumber: input.draft.manualPayment.accountNumber,
      },
      requirements: {
        facebookLink: input.draft.requirements.facebookLink,
        instagramLink: input.draft.requirements.instagramLink,
        emergencyContact: {
          fullName: input.draft.requirements.emergencyContact.fullName,
          relationship: input.draft.requirements.emergencyContact.relationship,
          phone: input.draft.requirements.emergencyContact.phone,
          facebookLink: input.draft.requirements.emergencyContact.facebookLink,
        },
      },
      agreement: {
        infoAccurate: input.draft.agreement.infoAccurate,
        agreedToTerms: input.draft.agreement.agreedToTerms,
        understoodRentalRules: input.draft.agreement.understoodRentalRules,
        authorizedESignature: input.draft.agreement.authorizedESignature,
        readPrivacyNotice: input.draft.agreement.readPrivacyNotice,
        emergencyContactAuthorized: input.draft.agreement.emergencyContactAuthorized,
        signatureMethod: input.draft.agreement.signatureMethod,
        typedFullName: input.draft.agreement.typedFullName,
      },
    },
  };
  return JSON.stringify(stored);
}

export function restoreReservationProgress(
  raw: string | null,
  now = Date.now(),
): RestoredReservationProgress | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as Partial<StoredReservationProgress>;
    if (
      stored.version !== STORAGE_VERSION ||
      typeof stored.savedAt !== "number" ||
      now - stored.savedAt > RESERVATION_PROGRESS_TTL_MS ||
      !stored.draft ||
      typeof stored.draft !== "object"
    ) return null;

    const empty = createEmptyDraft();
    const draft = stored.draft as Partial<StoredReservationProgress["draft"]>;
    const customer = (draft.customerInfo ?? {}) as Partial<CustomerInfoDraft>;
    const manualPayment = (draft.manualPayment ?? {}) as Partial<StoredReservationProgress["draft"]["manualPayment"]>;
    const requirements = (draft.requirements ?? {}) as Partial<StoredReservationProgress["draft"]["requirements"]>;
    const emergency = (requirements.emergencyContact ?? {}) as Partial<StoredReservationProgress["draft"]["requirements"]["emergencyContact"]>;
    const agreement = (draft.agreement ?? {}) as Partial<StoredReservationProgress["draft"]["agreement"]>;
    const fulfillmentMethod = draft.fulfillmentMethod === "pickup" || draft.fulfillmentMethod === "delivery"
      ? draft.fulfillmentMethod
      : null;
    const option = draft.paymentOption === "full" ? "full" : "deposit_50";

    const restoredStartDate = date(draft.startDate);
    const restoredEndDate = date(draft.endDate);
    const restoredRentalEndDate = date(draft.rentalEndDate) ?? (
      restoredEndDate
        ? new Date(restoredEndDate.getTime() - 22 * 60 * 60 * 1000)
        : restoredStartDate
    );

    return {
      savedAt: stored.savedAt,
      step: Math.min(6, Math.max(1, Math.floor(Number(stored.step) || 1))),
      bookingId: typeof stored.bookingId === "string" ? stored.bookingId : null,
      bookingNumber: typeof stored.bookingNumber === "string" ? stored.bookingNumber : null,
      paymentState: paymentState(stored.paymentState),
      isDemoPayment: stored.isDemoPayment === true,
      draft: {
        ...empty,
        quantity: Math.min(10, Math.max(1, Math.floor(Number(draft.quantity) || 1))),
        startDate: restoredStartDate,
        endDate: restoredEndDate,
        rentalEndDate: restoredRentalEndDate,
        pickupTime: text(draft.pickupTime),
        pickupConvenienceFee: Math.max(0, Number(draft.pickupConvenienceFee) || 0),
        fulfillmentMethod,
        customerLocation: text(draft.customerLocation),
        cityMunicipality: text(draft.cityMunicipality),
        province: text(draft.province),
        paymentOption: option,
        customerInfo: {
          ...empty.customerInfo,
          fullName: text(customer.fullName),
          email: text(customer.email),
          phone: text(customer.phone),
          birthDate: text(customer.birthDate),
          streetBarangay: text(customer.streetBarangay),
          cityMunicipality: text(customer.cityMunicipality),
          province: text(customer.province),
          address: text(customer.address),
          facebookLink: text(customer.facebookLink),
          instagramLink: text(customer.instagramLink),
        },
        manualPayment: {
          ...empty.manualPayment,
          referenceNumber: text(manualPayment.referenceNumber),
          accountName: text(manualPayment.accountName),
          accountNumber: text(manualPayment.accountNumber),
        },
        requirements: {
          ...empty.requirements,
          facebookLink: text(requirements.facebookLink),
          instagramLink: text(requirements.instagramLink),
          emergencyContact: {
            ...empty.requirements.emergencyContact,
            fullName: text(emergency.fullName),
            relationship: text(emergency.relationship),
            phone: text(emergency.phone),
            facebookLink: text(emergency.facebookLink),
          },
        },
        agreement: {
          ...empty.agreement,
          infoAccurate: agreement.infoAccurate === true,
          agreedToTerms: agreement.agreedToTerms === true,
          understoodRentalRules: agreement.understoodRentalRules === true,
          authorizedESignature: agreement.authorizedESignature === true,
          readPrivacyNotice: agreement.readPrivacyNotice === true,
          emergencyContactAuthorized: agreement.emergencyContactAuthorized === true,
          signatureMethod: agreement.signatureMethod === "uploaded" ? "uploaded" : "drawn",
          typedFullName: text(agreement.typedFullName),
        },
      },
    };
  } catch {
    return null;
  }
}
