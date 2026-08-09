"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Product } from "@/types/product";
import type { UnitCounts } from "@/lib/availability";
import { useAuth } from "@/hooks/useAuth";
import { createClient } from "@/src/lib/supabase/client";
import Spinner from "@/components/ui/Spinner";
import ReservationStepper from "@/components/reservation/ReservationStepper";
import StepRentalDetails from "@/components/reservation/StepRentalDetails";
import StepCustomerInfo from "@/components/reservation/StepCustomerInfo";
import StepRequirements from "@/components/reservation/StepRequirements";
import StepAgreement from "@/components/reservation/StepAgreement";
import StepPaymentSubmission, {
  type BookingPaymentState,
} from "@/components/reservation/StepPaymentSubmission";
import StepBookingConfirmation from "@/components/reservation/StepBookingConfirmation";
import { useToast } from "@/components/ui/ToastProvider";
import { createEmptyDraft, formatCustomerLocation, getDayCount, parseCustomerAddress, type ReservationDraft } from "@/src/types/reservationDraft";
import {
  createBookingReservation,
  submitBookingDocuments,
} from "@/src/services/bookingSubmissionService";
import { createPaymentCheckout, getReservationResumeState, reconcilePayment } from "@/src/services/paymentService";
import { getCustomerRewardProgress } from "@/src/services/bookingService";
import { startGuestCheckout } from "@/src/services/authService";
import { useCart } from "@/hooks/useCart";
import { calculateReservationPricing } from "@/src/lib/reservationPricing";
import {
  reservationProgressKey,
  restoreReservationProgress,
  serializeReservationProgress,
} from "@/src/lib/reservationProgress";
import type { RewardProgress } from "@/src/lib/promotions";
import styles from "./reserve.module.css";

const STEP_LABELS = [
  "Rental Details",
  "Reservation",
  "Payment Submission",
  "Verification Documents",
  "Rental Agreement",
  "Booking Confirmation",
];

interface ReserveFlowClientProps {
  product: Product;
  units: UnitCounts;
  returnQuery?: string;
}

function ReserveFlowInner({ product, units, isGuest }: ReserveFlowClientProps & { isGuest: boolean }) {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { items: cartItems, removeItem: removeCartItem } = useCart();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ReservationDraft>(createEmptyDraft());
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [bookingNumber, setBookingNumber] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<BookingPaymentState>("unpaid");
  const [isDemoPayment, setIsDemoPayment] = useState(false);
  const [openingPayment, setOpeningPayment] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [receiptReady, setReceiptReady] = useState(false);
  const [submittingDocuments, setSubmittingDocuments] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [progressHydrated, setProgressHydrated] = useState(false);
  const [progressRestored, setProgressRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [rewardProgress, setRewardProgress] = useState<RewardProgress>({
    completedRentals: 0,
    loyaltyRewardUsed: false,
  });

  const progressKey = reservationProgressKey(user!.id, product.id);

  useEffect(() => {
    let rawProgress: string | null = null;
    try {
      rawProgress = window.localStorage.getItem(progressKey);
    } catch {
      // Some privacy modes disable localStorage. The live form still works.
    }
    const restored = restoreReservationProgress(rawProgress);
    if (restored) {
      const hasVerifiedPayment = restored.paymentState === "paid" || restored.paymentState === "partially_paid";
      // Verification files and signature images are intentionally never saved
      // to localStorage. Return to the document step when those files are needed.
      const safeStep = !restored.bookingId
        ? Math.min(restored.step, 3)
        : hasVerifiedPayment
          ? Math.min(restored.step, 4)
          : Math.min(restored.step, 3);
      // One-time hydration from the browser-owned draft backup.
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
    // One-time hydration of the locally editable booking form from async auth/profile data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((current) => ({
      ...current,
      customerInfo: {
        ...current.customerInfo,
        fullName: current.customerInfo.fullName || (isGuest ? "" : profile?.displayName ?? (user.user_metadata?.display_name as string | undefined) ?? ""),
        email: current.customerInfo.email || (isGuest ? "" : profile?.email ?? user.email ?? ""),
        phone: current.customerInfo.phone || profile?.phoneNumber || "",
        birthDate: current.customerInfo.birthDate || profile?.birthDate || "",
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
        // Saving is a convenience; never interrupt an active booking if the
        // browser refuses storage or its quota is full.
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
    const params = new URLSearchParams(window.location.search);
    if (params.get("cartItem") !== product.id) return;
    const cartItem = cartItems.find((item) => item.productId === product.id);
    if (!cartItem) return;
    const quantity = Math.min(Math.max(1, cartItem.quantity), Math.max(1, units.totalUnits));
    // Sync the persisted browser cart into the editable reservation draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((current) => current.quantity === quantity ? current : { ...current, quantity });
  }, [cartItems, product.id, units.totalUnits]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const resumedBookingId = params.get("bookingId");
    if (!resumedBookingId) return;
    const activeBookingId = resumedBookingId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const returnedFromPayment = params.get("payment") === "success";
    const paymentCancelled = params.get("payment") === "cancelled";
    let attempts = 0;

    async function refreshBooking() {
      // A booking ID supplied by our PayMongo return URL is authoritative.
      // Move to Payment Submission immediately instead of letting an empty or
      // stale browser draft show Rental Details while verification runs.
      setBookingId(activeBookingId);
      setStep(3);
      if (returnedFromPayment) setCheckingPayment(true);

      let providerFailed = false;
      if (returnedFromPayment) {
        try {
          const providerStatus = await reconcilePayment(activeBookingId);
          if (providerStatus === "failed") {
            providerFailed = true;
            setCheckingPayment(false);
            setPaymentError(
              "PayMongo reports that this payment attempt failed. Please start a new secure checkout.",
            );
          }
        } catch (error) {
          if (!cancelled && attempts >= 14) {
            setPaymentError(
              error instanceof Error ? error.message : "The payment status could not be confirmed.",
            );
          }
        }
      }

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
      const booking = resumeState.booking;
      if (booking.productId !== product.id || cancelled) {
        setCheckingPayment(false);
        setPaymentError("This reservation belongs to a different rental item.");
        return;
      }

      const nextState: BookingPaymentState = resumeState.paymentState;

      setBookingId(booking.id);
      setBookingNumber(booking.bookingRef);
      setPaymentState(nextState);
      setIsDemoPayment(resumeState.isDemoPayment);
      setReceiptReady(resumeState.receiptReady);
      setDraft((current) => ({
        ...current,
        quantity: booking.quantity,
        startDate: new Date(booking.startDate),
        endDate: new Date(booking.endDate),
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
      if (nextState === "paid" || nextState === "partially_paid") {
        setCheckingPayment(false);
        setPaymentError(null);
        return;
      }

      if (returnedFromPayment && attempts < 15 && !providerFailed) {
        attempts += 1;
        setCheckingPayment(true);
        timer = setTimeout(refreshBooking, 2000);
      } else {
        setCheckingPayment(false);
        if (returnedFromPayment) {
          setPaymentError(
            "PayMongo is still confirming the transaction. Please wait a moment, then refresh this page.",
          );
        } else if (paymentCancelled) {
          setPaymentError("Payment was cancelled. Your reservation can still be paid from here.");
        }
      }
    }

    void refreshBooking();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user, product.id]);

  function updateDraft(patch: Partial<ReservationDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function goToStep(nextStep: number) {
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handlePayment() {
    if (!user) return;
    setOpeningPayment(true);
    setPaymentError(null);

    try {
      let activeBookingId = bookingId;
      let activeBookingNumber = bookingNumber;
      if (!activeBookingId) {
        const supabase = createClient();
        const reservation = await createBookingReservation(supabase, product, draft);
        activeBookingId = reservation.bookingId;
        activeBookingNumber = reservation.bookingNumber ?? reservation.bookingId;
        setBookingId(activeBookingId);
        setBookingNumber(activeBookingNumber);
      }

      const returnPath = `/catalog/${encodeURIComponent(product.id)}/reserve?bookingId=${encodeURIComponent(activeBookingId)}`;
      const checkout = await createPaymentCheckout(activeBookingId, draft.paymentOption, returnPath);
      setIsDemoPayment(checkout.checkoutUrl.includes("/demo/paymongo"));
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setOpeningPayment(false);
      setPaymentError(error instanceof Error ? error.message : "The secure PayMongo checkout could not be opened.");
    }
  }

  async function handleDocumentSubmission() {
    if (!user || !bookingId || !bookingNumber) return;
    setSubmittingDocuments(true);
    try {
      await submitBookingDocuments(bookingId, draft);
      try {
        window.localStorage.removeItem(progressKey);
      } catch {
        // A completed booking no longer depends on the local draft backup.
      }
      removeCartItem(product.id);
      showToast("Verification documents and signed agreement submitted.", "success");
      goToStep(6);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "We couldn't submit your documents. Please try again.",
        "error",
      );
    } finally {
      setSubmittingDocuments(false);
    }
  }

  const agreementData = {
    bookingRef: bookingNumber ?? "Created before payment",
    customerName: draft.customerInfo.fullName || "-",
    productName: product.name,
    brand: product.brand ?? "",
    startDate: draft.startDate ?? new Date(),
    endDate: draft.endDate ?? new Date(),
    dayCount: getDayCount(draft.startDate, draft.endDate),
    fulfillmentMethod: draft.fulfillmentMethod ?? "pickup",
    customerLocation: draft.fulfillmentMethod ? formatCustomerLocation(draft) || "-" : "-",
    pricePerDay: product.pricePerDay,
    quantity: draft.quantity,
    currency: product.currency,
    includedAccessories: product.included,
  } as const;
  const pricing = calculateReservationPricing(product, draft, rewardProgress);

  return (
    <div className={styles.wrapper}>
      <header className={styles.reserveHeader}>
        <div>
          <p className={styles.eyebrow}>GUIDED RESERVATION</p>
          <h1>Reserve {product.name}</h1>
          <p>
            Complete one focused step at a time. Your progress, payment,
            documents, and agreement stay connected to this booking.
          </p>
        </div>
        <div className={styles.headerRate}>
          <span>Daily rate</span>
          <strong>{product.currency}{product.pricePerDay.toLocaleString()}</strong>
          <small>per rental day</small>
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

      <div className={styles.flowLayout}>
        <aside className={styles.bookingSummary} aria-label="Selected rental summary">
          <p className={styles.summaryEyebrow}>YOUR SELECTED RENTAL</p>
          <h2>{product.name}</h2>
          {Object.keys(product.specs).length > 0 ? (
            <dl className={styles.summarySpecs}>
              {Object.entries(product.specs).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <dl className={styles.summaryFacts}>
            <div>
              <dt>Rental inventory</dt>
              <dd>{units.totalUnits} {units.totalUnits === 1 ? "unit" : "units"} total</dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>{draft.quantity} {draft.quantity === 1 ? "unit" : "units"}</dd>
            </div>
            <div>
              <dt>Current total</dt>
              <dd>{pricing.rentalDays > 0 ? `${product.currency}${pricing.finalAmount.toLocaleString()}` : "Choose dates"}</dd>
            </div>
            <div>
              <dt>Included with rental</dt>
              <dd>{product.included.length ? `${product.included.length} items` : "See item details"}</dd>
            </div>
            <div>
              <dt>Current step</dt>
              <dd>{step} of {STEP_LABELS.length}</dd>
            </div>
          </dl>
          <Link href={`/catalog/${product.id}`} className={styles.detailsLink}>
            Review item details
          </Link>
          <div className={styles.secureNote}>
            <strong>Secure booking flow</strong>
            <span>Payment is completed through PayMongo before document submission.</span>
          </div>
        </aside>

        <div className={styles.card}>
          <div className={styles.cardTopline}>
            <span>Step {step} of {STEP_LABELS.length}</span>
            <strong>{STEP_LABELS[step - 1]}</strong>
          </div>
        {step === 1 ? (
          <StepCustomerInfo
            uid={user!.id}
            customerInfo={draft.customerInfo}
            onUpdate={(patch) =>
              updateDraft({ customerInfo: { ...draft.customerInfo, ...patch } })
            }
            onContinue={() => goToStep(2)}
            isGuest={isGuest}
            birthDateLocked={Boolean(profile?.birthDate)}
            birthDateVerified={Boolean(profile?.birthDateVerifiedAt)}
          />
        ) : null}

        {step === 2 ? (
          <StepRentalDetails
            product={product}
            units={units}
            draft={draft}
            onUpdate={updateDraft}
            onBack={() => goToStep(1)}
            onContinue={() => goToStep(3)}
          />
        ) : null}

        {step === 3 ? (
          <StepPaymentSubmission
            product={product}
            draft={draft}
            rewardProgress={rewardProgress}
            paymentState={paymentState}
            isDemoPayment={isDemoPayment}
            bookingId={bookingId ?? undefined}
            bookingNumber={bookingNumber ?? undefined}
            receiptReady={receiptReady}
            opening={openingPayment}
            checking={checkingPayment}
            error={paymentError}
            onPaymentOptionChange={(paymentOption) => updateDraft({ paymentOption })}
            onBack={() => goToStep(2)}
            onPay={() => void handlePayment()}
            onContinue={() => goToStep(4)}
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

export default function ReserveFlowClient(props: ReserveFlowClientProps) {
  const { user, loading } = useAuth();
  const [startingGuest, setStartingGuest] = useState(false);
  const [guestError, setGuestError] = useState<string | null>(null);

  if (loading) {
    return <div className={styles.gateLoading}><Spinner size={28} label="Preparing checkout" /></div>;
  }

  if (!user) {
    const reservePath = `/catalog/${props.product.id}/reserve${props.returnQuery ? `?${props.returnQuery}` : ""}`;
    const isReturningBooking = new URLSearchParams(props.returnQuery ?? "").has("bookingId");

    if (isReturningBooking) {
      return (
        <section className={styles.checkoutGate} aria-labelledby="resume-booking-heading">
          <p className={styles.eyebrow}>RESERVATION RECOVERY</p>
          <h1 id="resume-booking-heading">Sign in to resume your payment confirmation.</h1>
          <p>
            Your reservation link is safe. Your previous session expired while you were at
            PayMongo, so sign in with the same customer email and we&apos;ll return you directly
            to Payment Submission without asking you to enter the rental details again.
          </p>
          <div className={`${styles.gateOptions} ${styles.resumeGate}`}>
            <div>
              <strong>Continue the existing reservation</strong>
              <span>Do not create another booking or pay a second time.</span>
              <Link href={`/sign-in?redirect=${encodeURIComponent(reservePath)}`}>Sign In &amp; Resume</Link>
            </div>
          </div>
          <Link href="/account/bookings" className={styles.backToCart}>Open My Bookings</Link>
        </section>
      );
    }

    return (
      <section className={styles.checkoutGate} aria-labelledby="checkout-access-heading">
        <p className={styles.eyebrow}>CHECKOUT ACCESS</p>
        <h1 id="checkout-access-heading">Reserve with or without an account.</h1>
        <p>
          Guest checkout keeps this booking on the current browser. Signing in is recommended
          if you want permanent access to payment history, receipts, and invoices on other devices.
        </p>
        <div className={styles.gateOptions}>
          <div>
            <strong>Continue as guest</strong>
            <span>No password required. You will still provide an email for PayMongo and booking updates.</span>
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
            <Link href={`/sign-in?redirect=${encodeURIComponent(reservePath)}`}>Sign In</Link>
            <Link href={`/sign-up?redirect=${encodeURIComponent(reservePath)}`} className={styles.secondaryGateLink}>Create Account</Link>
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
        <Link href={`/verify-email?redirect=${encodeURIComponent(`/catalog/${props.product.id}/reserve`)}`}>Verify Email</Link>
      </section>
    );
  }

  return <ReserveFlowInner {...props} isGuest={user.is_anonymous === true} />;
}
