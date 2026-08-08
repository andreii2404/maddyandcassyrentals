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
import { createPaymentCheckout, reconcilePayment } from "@/src/services/paymentService";
import { getBookingById } from "@/src/services/bookingService";
import { startGuestCheckout } from "@/src/services/authService";
import { useCart } from "@/hooks/useCart";
import { calculateReservationPricing } from "@/src/lib/reservationPricing";
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
  const [submittingDocuments, setSubmittingDocuments] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (prefilled || !user) return;
    // One-time hydration of the locally editable booking form from async auth/profile data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft((current) => ({
      ...current,
      customerInfo: {
        fullName: isGuest ? "" : profile?.displayName ?? (user.user_metadata?.display_name as string | undefined) ?? "",
        email: isGuest ? "" : profile?.email ?? user.email ?? "",
        phone: profile?.phoneNumber ?? "",
        ...parseCustomerAddress(profile?.fullAddress),
        facebookLink: profile?.facebookLink ?? "",
        instagramLink: profile?.instagramLink ?? "",
      },
      requirements: {
        ...current.requirements,
        facebookLink: profile?.facebookLink ?? "",
        instagramLink: profile?.instagramLink ?? "",
      },
    }));
    setPrefilled(true);
  }, [user, profile, prefilled, isGuest]);

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
    const activeUser = user;
    const activeBookingId = resumedBookingId;
    const supabase = createClient();

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const returnedFromPayment = params.get("payment") === "success";
    const paymentCancelled = params.get("payment") === "cancelled";
    let attempts = 0;

    async function refreshBooking() {
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

      const booking = await getBookingById(supabase, activeBookingId);
      if (!booking || booking.customerId !== activeUser.id || booking.productId !== product.id || cancelled) {
        setPaymentError("This reservation could not be resumed.");
        return;
      }

      const { data: payments } = await supabase
        .from("booking_payment_submissions")
        .select("declared_amount, status, provider_metadata")
        .eq("booking_id", activeBookingId);

      const verifiedAmount = (payments ?? [])
        .filter((p) => p.status === "verified")
        .reduce((sum, p) => sum + p.declared_amount, 0);
      const hasPendingPayment = (payments ?? []).some((p) =>
        ["submitted", "under_review"].includes(p.status),
      );
      const demo = (payments ?? []).some(
        (p) => (p.provider_metadata as { demo?: boolean } | null)?.demo === true,
      );

      const nextState: BookingPaymentState =
        verifiedAmount <= 0
          ? hasPendingPayment
            ? "pending"
            : "unpaid"
          : verifiedAmount >= booking.totalAmount - 0.01
            ? "paid"
            : "partially_paid";

      setBookingId(booking.id);
      setBookingNumber(booking.bookingRef);
      setPaymentState(nextState);
      setIsDemoPayment(demo);
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
      setStep(3);

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
  const pricing = calculateReservationPricing(product, draft);

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
            paymentState={paymentState}
            isDemoPayment={isDemoPayment}
            bookingNumber={bookingNumber ?? undefined}
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
    const reservePath = `/catalog/${props.product.id}/reserve`;
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
