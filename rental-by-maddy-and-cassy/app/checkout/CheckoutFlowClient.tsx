"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Product } from "@/types/product";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import Spinner from "@/components/ui/Spinner";
import ReservationStepper from "@/components/reservation/ReservationStepper";
import StepCartRentalDetails from "@/components/reservation/StepCartRentalDetails";
import StepCustomerInfo from "@/components/reservation/StepCustomerInfo";
import StepRequirements from "@/components/reservation/StepRequirements";
import StepAgreement from "@/components/reservation/StepAgreement";
import StepCartPaymentSubmission, {
  type BookingPaymentState,
} from "@/components/reservation/StepCartPaymentSubmission";
import StepBookingConfirmation from "@/components/reservation/StepBookingConfirmation";
import { useToast } from "@/components/ui/ToastProvider";
import { createEmptyDraft, formatCustomerLocation, getDayCount, parseCustomerAddress, type ReservationDraft } from "@/src/types/reservationDraft";
import {
  createMultiItemBookingReservation,
  submitBookingDocuments,
} from "@/src/services/bookingSubmissionService";
import { getReservationResumeState, submitManualPayment } from "@/src/services/paymentService";
import { getBookingById, getCustomerRewardProgress } from "@/src/services/bookingService";
import { startGuestCheckout } from "@/src/services/authService";
import { useCart } from "@/hooks/useCart";
import { calculateMultiItemReservationPricing } from "@/src/lib/reservationPricing";
import {
  activeUnitAssignments,
  assertUnitAssignmentsComplete,
  getBookingUnitAssignments,
} from "@/src/services/unitAssignmentService";
import type { AgreementLineItem } from "@/src/types/booking";
import {
  reservationProgressKey,
  restoreReservationProgress,
  serializeReservationProgress,
} from "@/src/lib/reservationProgress";
import type { RewardProgress } from "@/src/lib/promotions";
import { manilaTimeInputValue } from "@/src/lib/rentalTiming";
import styles from "../catalog/[id]/reserve/reserve.module.css";

const STEP_LABELS = [
  "Rental Details",
  "Customer Info",
  "Payment Submission",
  "Verification Documents",
  "Rental Agreement",
  "Booking Confirmation",
];

/** Marks the shared browser-progress key for the cart's combined checkout (distinct from any single-product key). */
const CART_PROGRESS_SLUG = "cart-checkout";

interface CheckoutFlowClientProps {
  products: Product[];
  returnQuery?: string;
}

function CheckoutFlowInner({ products, isGuest }: CheckoutFlowClientProps & { isGuest: boolean }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { items: cartItems, removeItem } = useCart();
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const lines = useMemo(
    () =>
      cartItems.flatMap((item) => {
        const product = productsById.get(item.productId);
        return product ? [{ product, quantity: item.quantity }] : [];
      }),
    [cartItems, productsById],
  );

  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ReservationDraft>(createEmptyDraft());
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingNumber, setBookingNumber] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<BookingPaymentState>("unpaid");
  const [isDemoPayment, setIsDemoPayment] = useState(false);
  const [openingPayment, setOpeningPayment] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [submittingDocuments, setSubmittingDocuments] = useState(false);
  const documentSubmissionInFlightRef = useRef(false);
  const [prefilled, setPrefilled] = useState(false);
  const [progressHydrated, setProgressHydrated] = useState(false);
  const [progressRestored, setProgressRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [rewardProgress, setRewardProgress] = useState<RewardProgress>({
    completedRentals: 0,
    loyaltyRewardUsed: false,
  });
  const [unitsReady, setUnitsReady] = useState(false);
  const [unitsCheckError, setUnitsCheckError] = useState<string | null>(null);
  const [assignedUnitsByProductId, setAssignedUnitsByProductId] = useState<
    Map<string, AgreementLineItem["units"]>
  >(new Map());
  const [resumeMismatch, setResumeMismatch] = useState<string | null>(null);

  const progressKey = reservationProgressKey(user!.id, CART_PROGRESS_SLUG);

  useEffect(() => {
    let rawProgress: string | null = null;
    try {
      rawProgress = window.localStorage.getItem(progressKey);
    } catch {
      // Some privacy modes disable localStorage. The live form still works.
    }
    const restored = restoreReservationProgress(rawProgress);
    if (restored) {
      const hasSubmittedPayment = restored.paymentState !== "unpaid";
      const safeStep = !restored.bookingId
        ? Math.min(restored.step, 3)
        : hasSubmittedPayment
          ? Math.min(restored.step, 4)
          : Math.min(restored.step, 3);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(restored.draft);
      setStep(safeStep);
      setBookingId(restored.bookingId);
      setBookingNumber(restored.bookingNumber);
      setPaymentState(restored.paymentState);
      setIsDemoPayment(restored.isDemoPayment);
      setLastSavedAt(new Date(restored.savedAt));
      setProgressRestored(true);
    }
    setProgressHydrated(true);
  }, [progressKey]);

  useEffect(() => {
    if (!progressHydrated || prefilled || !user) return;
    const profileAddress = parseCustomerAddress(profile?.fullAddress);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((current) => ({
      ...current,
      customerInfo: {
        ...current.customerInfo,
        fullName: current.customerInfo.fullName || (isGuest ? "" : profile?.displayName ?? (user.user_metadata?.display_name as string | undefined) ?? ""),
        email: current.customerInfo.email || (isGuest ? "" : profile?.email ?? user.email ?? ""),
        phone: current.customerInfo.phone || profile?.phoneNumber || "",
        birthDate: current.customerInfo.birthDate || (isGuest ? "" : profile?.birthDate) || "",
        streetBarangay: current.customerInfo.streetBarangay || profileAddress.streetBarangay,
        cityMunicipality: current.customerInfo.cityMunicipality || profileAddress.cityMunicipality,
        province: current.customerInfo.province || profileAddress.province,
        address: current.customerInfo.address || profileAddress.address,
        facebookLink: current.customerInfo.facebookLink || profile?.facebookLink || "",
        instagramLink: current.customerInfo.instagramLink || profile?.instagramLink || "",
      },
      requirements: {
        ...current.requirements,
        facebookLink: current.requirements.facebookLink || profile?.facebookLink || "",
        instagramLink: current.requirements.instagramLink || profile?.instagramLink || "",
      },
    }));
    setPrefilled(true);
  }, [user, profile, prefilled, isGuest, progressHydrated]);

  useEffect(() => {
    if (!progressHydrated || !prefilled || step === 6) return;
    const saveProgress = () => {
      const savedAt = Date.now();
      try {
        window.localStorage.setItem(
          progressKey,
          serializeReservationProgress({
            draft,
            step,
            bookingId,
            bookingNumber,
            paymentState,
            isDemoPayment,
            savedAt,
          }),
        );
        setLastSavedAt(new Date(savedAt));
      } catch {
        // Saving is a convenience; never interrupt an active booking.
      }
    };
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveProgress();
    };
    const timer = window.setTimeout(saveProgress, 250);
    document.addEventListener("visibilitychange", saveWhenHidden);
    window.addEventListener("pagehide", saveProgress);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      window.removeEventListener("pagehide", saveProgress);
    };
  }, [
    bookingId,
    bookingNumber,
    draft,
    isDemoPayment,
    paymentState,
    prefilled,
    progressHydrated,
    progressKey,
    step,
  ]);

  useEffect(() => {
    if (!user || isGuest) return;
    let cancelled = false;
    void getCustomerRewardProgress(createClient(), user.id)
      .then((progress) => {
        if (!cancelled) setRewardProgress(progress);
      })
      .catch(() => {
        if (!cancelled) setRewardProgress({ completedRentals: 0, loyaltyRewardUsed: false });
      });
    return () => {
      cancelled = true;
    };
  }, [user, isGuest]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const resumedBookingId = params.get("bookingId");
    if (!resumedBookingId) return;
    const activeBookingId = resumedBookingId;
    let cancelled = false;

    async function refreshBooking() {
      setBookingId(activeBookingId);
      setStep(3);
      setCheckingPayment(true);

      let resumeState;
      try {
        resumeState = await getReservationResumeState(activeBookingId);
      } catch (error) {
        if (cancelled) return;
        setCheckingPayment(false);
        setPaymentError(
          error instanceof Error ? error.message : "This reservation could not be resumed.",
        );
        return;
      }
      if (cancelled) return;
      const booking = resumeState.booking;
      const bookingProductIds = new Set(booking.items.map((item) => item.productId));
      const cartProductIds = new Set(lines.map((line) => line.product.id));
      const sameItems =
        bookingProductIds.size === cartProductIds.size &&
        [...bookingProductIds].every((id) => cartProductIds.has(id));
      if (!sameItems) {
        setCheckingPayment(false);
        setResumeMismatch(
          "This reservation's items no longer match your current cart. Adjust your cart to match, or open the reservation from your account instead.",
        );
        return;
      }

      setBookingId(booking.id);
      setBookingNumber(booking.bookingRef);
      setPaymentState(resumeState.paymentState);
      setIsDemoPayment(resumeState.isDemoPayment);
      setDraft((current) => ({
        ...current,
        startDate: new Date(booking.startDate),
        endDate: new Date(booking.endDate),
        rentalEndDate: new Date(new Date(booking.endDate).getTime() - 22 * 60 * 60 * 1000),
        pickupTime: manilaTimeInputValue(booking.startDate),
        pickupConvenienceFee: booking.pickupConvenienceFee ?? 0,
        fulfillmentMethod: booking.fulfillmentMethod,
        customerLocation: booking.location ?? current.customerLocation,
        cityMunicipality: booking.cityMunicipality ?? "",
        province: booking.province ?? "",
        customerInfo: {
          ...current.customerInfo,
          ...booking.customerSnapshot,
          ...parseCustomerAddress(booking.customerSnapshot.address),
        },
      }));
      setCheckingPayment(false);
      setPaymentError(null);
    }

    void refreshBooking();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (step !== 5 || !bookingId) return;
    let cancelled = false;

    async function confirmUnits() {
      try {
        const supabase = createClient();
        const booking = await getBookingById(supabase, bookingId!);
        if (!booking || booking.items.length === 0) throw new Error("This booking could not be found.");
        const assignments = await getBookingUnitAssignments(supabase, bookingId!);
        assertUnitAssignmentsComplete(
          booking.items.map((item) => ({ bookingItemId: item.bookingItemId, quantity: item.quantity })),
          assignments,
        );
        if (cancelled) return;
        const byProductId = new Map<string, AgreementLineItem["units"]>();
        for (const item of booking.items) {
          byProductId.set(
            item.productId,
            activeUnitAssignments(assignments.get(item.bookingItemId)).map((assignment) => ({
              unitCode: assignment.unitCode,
              serialNumber: assignment.serialNumber,
            })),
          );
        }
        setAssignedUnitsByProductId(byProductId);
        setUnitsReady(true);
      } catch (error) {
        if (cancelled) return;
        setUnitsCheckError(
          error instanceof Error
            ? error.message
            : "We couldn't confirm your assigned units. Please try again.",
        );
      }
    }

    const checkTimerId = window.setTimeout(() => {
      if (cancelled) return;
      setUnitsReady(false);
      setUnitsCheckError(null);
      void confirmUnits();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(checkTimerId);
    };
  }, [step, bookingId]);

  const updateDraft = useCallback((patch: Partial<ReservationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  function goToStep(nextStep: number) {
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleManualPaymentContinue() {
    if (!user) return;
    setOpeningPayment(true);
    setPaymentError(null);

    try {
      let activeBookingId = bookingId;
      let activeBookingNumber = bookingNumber;
      if (!activeBookingId) {
        const supabase = createClient();
        const reservation = await createMultiItemBookingReservation(supabase, lines, draft, isGuest);
        activeBookingId = reservation.bookingId;
        activeBookingNumber = reservation.bookingNumber ?? reservation.bookingId;
        setBookingId(activeBookingId);
        setBookingNumber(activeBookingNumber);
      }

      if (paymentState === "unpaid") {
        if (!draft.manualPayment.proofFile) {
          throw new Error("Upload a screenshot or proof of payment.");
        }
        await submitManualPayment(activeBookingId, {
          referenceNumber: draft.manualPayment.referenceNumber.trim(),
          accountName: draft.manualPayment.accountName.trim(),
          accountNumber: draft.manualPayment.accountNumber.trim(),
          paymentOption: draft.paymentOption,
          proofFile: draft.manualPayment.proofFile,
        });
        setPaymentState("pending");
      }
      goToStep(4);
    } catch (error) {
      setPaymentError(
        error instanceof Error ? error.message : "We couldn't submit your payment details. Please try again.",
      );
    } finally {
      setOpeningPayment(false);
    }
  }

  async function handleDocumentSubmission() {
    if (!user || !bookingId || !bookingNumber) return;
    if (documentSubmissionInFlightRef.current) return;
    documentSubmissionInFlightRef.current = true;
    setSubmittingDocuments(true);
    try {
      await submitBookingDocuments(bookingId, draft);
      try {
        window.localStorage.removeItem(progressKey);
      } catch {
        // A completed booking no longer depends on the local draft backup.
      }
      for (const line of lines) removeItem(line.product.id);
      showToast("Verification documents and signed agreement submitted.", "success");
      goToStep(6);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[handleDocumentSubmission] agreement submission failed", { bookingId, error });
      }
      showToast(
        error instanceof Error ? error.message : "We couldn't submit your documents. Please try again.",
        "error",
      );
    } finally {
      documentSubmissionInFlightRef.current = false;
      setSubmittingDocuments(false);
    }
  }

  const pricing = calculateMultiItemReservationPricing(lines, draft, rewardProgress, isGuest);
  const currency = lines[0]?.product.currency ?? "PHP";
  const agreementData = {
    bookingRef: bookingNumber ?? "Created before payment",
    customerName: draft.customerInfo.fullName || "-",
    items: pricing.lines.map((line) => {
      const product = lines.find((cartLine) => cartLine.product.id === line.productId)?.product;
      return {
        productName: line.productName,
        brand: product?.brand ?? "",
        quantity: line.quantity,
        pricePerDay: line.pricePerDay,
        rentalDays: line.rentalDays,
        lineTotal: line.lineTotal,
        includedAccessories: product?.included ?? [],
        units: assignedUnitsByProductId.get(line.productId) ?? [],
      };
    }),
    startDate: draft.startDate ?? new Date(),
    endDate: draft.endDate ?? new Date(),
    dayCount: getDayCount(draft.startDate, draft.endDate),
    fulfillmentMethod: draft.fulfillmentMethod ?? "pickup",
    customerLocation: draft.fulfillmentMethod ? formatCustomerLocation(draft) || "-" : "-",
    currency,
    subtotal: pricing.productSubtotal,
    discountAmount: pricing.discountAmount,
    depositAmount: pricing.depositAmount,
    fees: pricing.fees,
    finalAmount: pricing.finalAmount,
  };

  if (resumeMismatch) {
    return (
      <section className={styles.checkoutGate}>
        <h1>Reservation and cart don&apos;t match.</h1>
        <p>{resumeMismatch}</p>
        <Link href="/cart" className={styles.backToCart}>← Back to rental cart</Link>
      </section>
    );
  }

  if (lines.length === 0 && !bookingId) {
    return (
      <section className={styles.checkoutGate}>
        <h1>Your cart is empty.</h1>
        <p>Add rentals to your cart, then return here to check out everything together.</p>
        <Link href="/cart" className={styles.backToCart}>← Back to rental cart</Link>
      </section>
    );
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.reserveHeader}>
        <div>
          <p className={styles.eyebrow}>COMBINED RENTAL CHECKOUT</p>
          <h1>Checkout your cart</h1>
          <p>
            One rental period, one payment, one verification round, and one signed agreement for
            every item in your cart.
          </p>
        </div>
        <div className={styles.headerRate}>
          <span>Items</span>
          <strong>{pricing.productCount} product{pricing.productCount === 1 ? "" : "s"}</strong>
          <small>{pricing.totalUnits} unit{pricing.totalUnits === 1 ? "" : "s"} total</small>
        </div>
      </header>

      <div className={styles.progressSaved} role="status">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>{progressRestored ? "Your saved progress was restored" : "Progress saved on this device"}</strong>
          <small>
            {lastSavedAt
              ? `Last saved ${lastSavedAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}. Verification files and signature images are not stored.`
              : "Your form will stay in place when you switch tabs or return to this browser."}
          </small>
        </div>
      </div>

      <ReservationStepper steps={STEP_LABELS} currentStep={step} />

      <div className={`${styles.flowLayout} ${step === 1 ? styles.flowLayoutNoSidebar : ""}`}>
        {step === 1 ? null : (
        <aside className={styles.bookingSummary} aria-label="Selected rental summary">
          <p className={styles.summaryEyebrow}>YOUR CART</p>
          <h2>{pricing.productCount} product{pricing.productCount === 1 ? "" : "s"}</h2>
          <dl className={styles.summaryFacts}>
            {lines.map((line) => (
              <div key={line.product.id}>
                <dt>{line.product.name}</dt>
                <dd>{line.quantity} {line.quantity === 1 ? "unit" : "units"}</dd>
              </div>
            ))}
            <div>
              <dt>Current total</dt>
              <dd>{pricing.rentalDays > 0 ? `${currency}${pricing.finalAmount.toLocaleString()}` : "Choose dates"}</dd>
            </div>
            <div>
              <dt>Current step</dt>
              <dd>{step} of {STEP_LABELS.length}</dd>
            </div>
          </dl>
          <Link href="/cart" className={styles.detailsLink}>
            Edit cart
          </Link>
          <div className={styles.secureNote}>
            <strong>Secure booking flow</strong>
            <span>Payment is completed manually via GCash before document submission.</span>
          </div>
        </aside>
        )}

        <div className={styles.card}>
          <div className={styles.cardTopline}>
            <span>Step {step} of {STEP_LABELS.length}</span>
            <strong>{STEP_LABELS[step - 1]}</strong>
          </div>
        {step === 1 ? (
          <StepCartRentalDetails
            lines={lines}
            draft={draft}
            pricing={pricing}
            onUpdate={updateDraft}
            onContinue={() => goToStep(2)}
          />
        ) : null}

        {step === 2 ? (
          <StepCustomerInfo
            uid={user!.id}
            customerInfo={draft.customerInfo}
            onUpdate={(patch) =>
              updateDraft({ customerInfo: { ...draft.customerInfo, ...patch } })
            }
            onBack={() => goToStep(1)}
            onContinue={() => goToStep(3)}
            isGuest={isGuest}
            birthDateLocked={!isGuest && Boolean(profile?.birthDate)}
            birthDateVerified={!isGuest && Boolean(profile?.birthDateVerifiedAt)}
          />
        ) : null}

        {step === 3 ? (
          <StepCartPaymentSubmission
            pricing={pricing}
            currency={currency}
            draft={draft}
            rewardProgress={rewardProgress}
            isGuest={isGuest}
            paymentState={paymentState}
            bookingNumber={bookingNumber ?? undefined}
            opening={openingPayment || checkingPayment}
            error={paymentError}
            onPaymentOptionChange={(paymentOption) => updateDraft({ paymentOption })}
            onManualPaymentUpdate={(patch) =>
              updateDraft({ manualPayment: { ...draft.manualPayment, ...patch } })
            }
            onBack={() => goToStep(1)}
            onContinue={() => void handleManualPaymentContinue()}
          />
        ) : null}

        {step === 4 ? (
          <StepRequirements
            requirements={draft.requirements}
            onUpdate={(patch) =>
              updateDraft({ requirements: { ...draft.requirements, ...patch } })
            }
            onBack={() => goToStep(3)}
            onContinue={() => goToStep(5)}
          />
        ) : null}

        {step === 5 ? (
          <StepAgreement
            agreementData={agreementData}
            agreement={draft.agreement}
            onUpdate={(patch) => updateDraft({ agreement: { ...draft.agreement, ...patch } })}
            onBack={() => goToStep(4)}
            onContinue={() => void handleDocumentSubmission()}
            submitting={submittingDocuments}
            unitsReady={unitsReady}
            unitsCheckError={unitsCheckError}
          />
        ) : null}

        {step === 6 && bookingId && bookingNumber ? (
          <StepBookingConfirmation
            bookingId={bookingId}
            bookingNumber={bookingNumber}
            isDemo={isDemoPayment}
            isGuest={isGuest}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}

export default function CheckoutFlowClient(props: CheckoutFlowClientProps) {
  const { user, loading } = useAuth();
  const [startingGuest, setStartingGuest] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);

  if (loading) {
    return <div className={styles.gateLoading}><Spinner size={28} label="Preparing checkout" /></div>;
  }

  if (!user) {
    const isReturningBooking = new URLSearchParams(props.returnQuery ?? "").has("bookingId");
    const checkoutPath = `/checkout${props.returnQuery ? `?${props.returnQuery}` : ""}`;

    if (isReturningBooking) {
      return (
        <section className={styles.checkoutGate} aria-labelledby="resume-booking-heading">
          <p className={styles.eyebrow}>RESERVATION RECOVERY</p>
          <h1 id="resume-booking-heading">Sign in to resume your payment confirmation.</h1>
          <p>
            Your reservation link is safe. Your previous session expired, so sign in with the
            same customer email and we&apos;ll return you directly to Payment Submission without
            asking you to enter the rental details again.
          </p>
          <div className={`${styles.gateOptions} ${styles.resumeGate}`}>
            <div>
              <strong>Continue the existing reservation</strong>
              <span>Do not create another booking or pay a second time.</span>
              <Link href={`/sign-in?redirect=${encodeURIComponent(checkoutPath)}`}>Sign In &amp; Resume</Link>
            </div>
          </div>
          <Link href="/account/bookings" className={styles.backToCart}>Open My Bookings</Link>
        </section>
      );
    }

    return (
      <section className={styles.checkoutGate} aria-labelledby="checkout-access-heading">
        <p className={styles.eyebrow}>CHECKOUT ACCESS</p>
        <h1 id="checkout-access-heading">Check out with or without an account.</h1>
        <p>
          Guest checkout keeps this booking on the current browser. Signing in is recommended
          if you want permanent access to payment history, receipts, and invoices on other devices.
        </p>
        <div className={styles.gateOptions}>
          <div>
            <strong>Continue as guest</strong>
            <span>No password required. You will still provide an email for booking updates.</span>
            <button
              type="button"
              disabled={startingGuest}
              onClick={async () => {
                setStartingGuest(true);
                setGuestError(null);
                try {
                  await startGuestCheckout();
                } catch (error) {
                  setGuestError(error instanceof Error ? error.message : "Guest checkout could not be started.");
                  setStartingGuest(false);
                }
              }}
            >
              {startingGuest ? "Starting guest checkout…" : "Continue as Guest"}
            </button>
          </div>
          <div>
            <strong>Use a customer account</strong>
            <span>Save booking history and open receipts or invoices from any signed-in device.</span>
            <Link href={`/sign-in?redirect=${encodeURIComponent(checkoutPath)}`}>Sign In</Link>
            <Link href={`/sign-up?redirect=${encodeURIComponent(checkoutPath)}`} className={styles.secondaryGateLink}>Create Account</Link>
          </div>
        </div>
        {guestError ? <p className={styles.gateError} role="alert">{guestError}</p> : null}
        <Link href="/cart" className={styles.backToCart}>← Back to rental cart</Link>
      </section>
    );
  }

  if (!user.email_confirmed_at && !user.is_anonymous) {
    return (
      <section className={styles.checkoutGate}>
        <h1>Verify your email to continue.</h1>
        <p>Your customer account needs a verified email before a payment or document submission can begin.</p>
        <Link href={`/verify-email?redirect=${encodeURIComponent("/checkout")}`}>Verify Email</Link>
      </section>
    );
  }

  return <CheckoutFlowInner {...props} isGuest={user.is_anonymous === true} />;
}
