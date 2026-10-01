"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useFavorites } from "@/hooks/useFavorites";
import { useCart } from "@/hooks/useCart";
import { useCustomerBookingCount } from "@/hooks/useCustomerBookingCount";
import { logout } from "@/src/services/authService";
import { hasGuestCheckoutBooking } from "@/src/services/bookingService";
import { createClient } from "@/src/lib/supabase/client";
import { GUEST_BOOKING_CREATED_EVENT } from "@/src/lib/guestBookingEvents";
import { Button } from "@/components/ui/Button";
import SignOutConfirmModal from "./SignOutConfirmModal";
import TrackBookingModal from "@/components/booking-lookup/TrackBookingModal";
import styles from "./Navbar.module.css";

const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Browse" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

const guideLinks = [
  { href: "/how-to-book", label: "How to Book", description: "Booking steps" },
  { href: "/rental-requirements", label: "Requirements", description: "What to prepare" },
  { href: "/terms", label: "Terms & Conditions", description: "Rental policies" },
  { href: "/faq", label: "FAQs", description: "Quick answers" },
];

const storyLinks = [
  { href: "/reviews", label: "Reviews", description: "Verified renter feedback" },
];

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 7H6" />
      <circle cx="9.5" cy="19" r="1.25" />
      <circle cx="17.5" cy="19" r="1.25" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.7 9.7 0 0 1-3.7-.8L3 21l1.7-4.6A8.3 8.3 0 1 1 21 11.5Z" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" />
    </svg>
  );
}

function TrackIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
      <path d="M8.5 11h5M11 8.5v5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d="m2.5 4 3.5 3.5L9.5 4" />
    </svg>
  );
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getHashSnapshot() {
  return window.location.hash;
}

function getServerHashSnapshot() {
  return "";
}

function getHrefHash(href: string): string {
  const index = href.indexOf("#");
  return index === -1 ? "" : href.slice(index);
}

export default function Navbar() {
  const { user, profile, isAdmin } = useAuth();
  // Anonymous Supabase sessions back guest checkout. They carry a real `user`
  // object but are not a customer account, so account-only nav must treat
  // them the same as signed-out visitors.
  const isAccountHolder = Boolean(user) && !user?.is_anonymous;
  // Track Guest Booking only appears once this browser's guest session owns a
  // real guest-checkout booking. Starting guest checkout alone creates the
  // anonymous session, so `is_anonymous` by itself is not enough. The owner id
  // is stored (not a boolean) so a stale result never leaks across sessions.
  const guestUserId = user?.is_anonymous ? user.id : null;
  const [guestBookingOwnerId, setGuestBookingOwnerId] = useState<string | null>(null);
  const showGuestTracking = guestUserId !== null && guestBookingOwnerId === guestUserId;
  const { favorites } = useFavorites();
  const { totalQuantity } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  // Badge count for the customer "My Bookings" menu item. Admins and guest
  // (anonymous) sessions never subscribe. Re-counts on route change too, so a
  // booking created during checkout shows up even if realtime is unavailable.
  const bookingCountCustomerId = isAccountHolder && !isAdmin && user ? user.id : null;
  const bookingCount = useCustomerBookingCount(bookingCountCustomerId, pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [trackBookingOpen, setTrackBookingOpen] = useState(false);
  const guideRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const syncedHash = useSyncExternalStore(subscribeToHash, getHashSnapshot, getServerHashSnapshot);
  // Next.js <Link> navigates same-page hash changes via history.pushState,
  // which never fires a "hashchange" event, so syncedHash alone lags behind
  // a click. clickedHash is an optimistic override applied the instant a nav
  // link is clicked so the active state updates in the same frame.
  const [clickedHash, setClickedHash] = useState<string | null>(null);
  const hash = clickedHash ?? syncedHash;
  // Next.js does not reliably scroll to a fragment when the navigation is a
  // same-page hash-only change (pathname unchanged), and its cross-page
  // fragment scroll can also race the sticky navbar layout. pendingScrollHash
  // records the target of the most recent primary-link click so the effect
  // below can drive the scroll itself once the destination is on screen.
  const pendingScrollHash = useRef<string | null>(null);

  // Re-check on session change and on each route change until a guest booking
  // is confirmed, plus immediately when a checkout flow reports a new booking
  // (the booking step does not change the URL).
  useEffect(() => {
    if (!guestUserId || guestBookingOwnerId === guestUserId) return undefined;
    const ownerId = guestUserId;
    let cancelled = false;

    async function checkGuestBooking() {
      try {
        const hasBooking = await hasGuestCheckoutBooking(createClient(), ownerId);
        if (!cancelled && hasBooking) setGuestBookingOwnerId(ownerId);
      } catch {
        // Leave the link hidden; the next route change or booking event retries.
      }
    }

    void checkGuestBooking();
    window.addEventListener(GUEST_BOOKING_CREATED_EVENT, checkGuestBooking);
    return () => {
      cancelled = true;
      window.removeEventListener(GUEST_BOOKING_CREATED_EVENT, checkGuestBooking);
    };
  }, [guestUserId, guestBookingOwnerId, pathname]);

  function closeDropdowns() {
    setGuideOpen(false);
    setProfileOpen(false);
  }

  // The navbar stays mounted across client-side route changes, so any open
  // dropdown must be closed explicitly when the route (or in-page hash) changes.
  useEffect(() => {
    const closeTimerId = window.setTimeout(closeDropdowns, 0);
    return () => window.clearTimeout(closeTimerId);
  }, [pathname, hash]);

  // Defer back to the real browser hash once it catches up (back/forward,
  // full loads) or once a full route change happens, so the override never
  // goes stale.
  useEffect(() => {
    const syncTimerId = window.setTimeout(() => setClickedHash(null), 0);
    return () => window.clearTimeout(syncTimerId);
  }, [pathname, syncedHash]);

  // Actually perform the Home navigation's scroll. Next.js's built-in
  // scrolling is not reliable for a same-page hash-only navigation (pathname
  // unchanged), so a primary-link click records itself in pendingScrollHash
  // and this effect scrolls to the top once we're on "/" - immediately for a
  // same-page click, or after landing here from another route.
  useEffect(() => {
    if (pathname !== "/" || pendingScrollHash.current === null) return;
    pendingScrollHash.current = null;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);

  useEffect(() => {
    if (!guideOpen && !profileOpen) return undefined;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (guideOpen && guideRef.current && !guideRef.current.contains(target)) {
        setGuideOpen(false);
      }
      if (profileOpen && profileRef.current && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDropdowns();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [guideOpen, profileOpen]);

  async function handleSignOut() {
    await logout();
    setMenuOpen(false);
    setProfileOpen(false);
    router.push("/");
  }

  // Customers confirm before signing out; admins keep the direct sign-out.
  function requestSignOut() {
    setMenuOpen(false);
    setProfileOpen(false);
    if (isAdmin) {
      void handleSignOut();
      return;
    }
    setSignOutError(null);
    setSignOutConfirmOpen(true);
  }

  async function confirmSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await logout();
      setSignOutConfirmOpen(false);
      router.push("/");
      router.refresh();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : "You could not be signed out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }

  const displayName = profile?.displayName || user?.user_metadata?.display_name || "Account";
  const firstName = displayName.split(" ")[0];
  const initial = firstName.charAt(0).toUpperCase() || "A";
  const accountHomeHref = isAdmin ? "/admin" : "/account/bookings";
  const accountHomeLabel = isAdmin ? "Admin Dashboard" : "My Bookings";
  const showBookingCount = !isAdmin && bookingCount !== null && bookingCount > 0;
  const profileHref = "/account/profile";
  const profileLabel = "My Profile";
  const guideActive = [...guideLinks, ...storyLinks].some((item) => pathname === item.href);
  const guestTrackingActive = pathname.startsWith("/guest/bookings");

  function isPrimaryLinkActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    if (href === "/catalog") return pathname.startsWith("/catalog");
    return pathname === href;
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function openTrackBooking() {
    setMenuOpen(false);
    closeDropdowns();
    setTrackBookingOpen(true);
  }

  function handlePrimaryLinkClick(href: string) {
    const hrefHash = getHrefHash(href);
    setClickedHash(hrefHash);
    pendingScrollHash.current = hrefHash;
  }

  return (
    <>
    <header className={styles.navbar}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label="Rental by Maddy & Cassy home">
          <span className={styles.brandIcon}>
            <Image
              src="/images/maddy-cassy-rentals-logo.png"
              alt=""
              width={46}
              height={46}
              className={styles.logoImage}
              priority
            />
          </span>
          <span className={styles.brandCopy}>
            <strong>Rental by</strong>
            <span>Maddy &amp; Cassy</span>
          </span>
        </Link>

        <nav className={styles.links} aria-label="Primary navigation">
          {primaryLinks.map((item) => {
            const active = isPrimaryLinkActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.link} ${active ? styles.linkActive : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  closeDropdowns();
                  handlePrimaryLinkClick(item.href);
                }}
              >
                {item.label}
              </Link>
            );
          })}

          <div className={styles.guideMenu} ref={guideRef}>
            <Button
              variant="none"
              className={`${styles.guideTrigger} ${guideActive ? styles.linkActive : ""} ${guideOpen ? styles.guideTriggerOpen : ""}`}
              aria-expanded={guideOpen}
              aria-haspopup="true"
              onClick={() => {
                setGuideOpen((open) => !open);
                setProfileOpen(false);
              }}
            >
              Rental Guide
              <ChevronIcon />
            </Button>
            {guideOpen ? (
              <div className={styles.guideDropdown}>
                <p>Plan your rental</p>
                {guideLinks.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.guideMenuLink} ${active ? styles.guideMenuLinkActive : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setGuideOpen(false)}
                    >
                      <span>{item.label}</span>
                      <small>{item.description}</small>
                    </Link>
                  );
                })}
                <p className={styles.guideDropdownSection}>Customer Stories &amp; Reviews</p>
                {storyLinks.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.guideMenuLink} ${active ? styles.guideMenuLinkActive : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setGuideOpen(false)}
                    >
                      <span>{item.label}</span>
                      <small>{item.description}</small>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>

        <div className={styles.actions}>
          <div className={styles.quickActions} aria-label="Messages, saved items, and cart">
            <Link
              href="/messages"
              className={`${styles.iconAction} ${pathname === "/messages" ? styles.iconActionActive : ""}`}
              aria-label="Messages"
              title="Messages"
            >
              <MessageIcon />
            </Link>
            <Link
              href="/favorites"
              className={`${styles.iconAction} ${pathname === "/favorites" ? styles.iconActionActive : ""}`}
              aria-label={`Favorites${favorites.length ? `, ${favorites.length} saved` : ""}`}
              title="Favorites"
            >
              <HeartIcon />
              {favorites.length > 0 ? <span className={styles.actionCount}>{favorites.length}</span> : null}
            </Link>
            <Link
              href="/cart"
              className={`${styles.iconAction} ${pathname === "/cart" ? styles.iconActionActive : ""}`}
              aria-label={`Rental cart${totalQuantity ? `, ${totalQuantity} items` : ""}`}
              title="Rental cart"
            >
              <CartIcon />
              {totalQuantity > 0 ? <span className={styles.actionCount}>{totalQuantity}</span> : null}
            </Link>
          </div>

          <span className={styles.actionDivider} aria-hidden="true" />

          {!isAdmin ? (
            <Button
              variant="none"
              className={styles.trackBookingButton}
              aria-haspopup="dialog"
              aria-label="Track Booking"
              title="Track Booking"
              onClick={openTrackBooking}
            >
              <TrackIcon />
              <span className={styles.trackBookingLabel}>Track Booking</span>
            </Button>
          ) : null}

          {isAccountHolder ? (
            <div className={styles.profileMenu} ref={profileRef}>
              <Button
                variant="none"
                className={`${styles.profileTrigger} ${profileOpen ? styles.profileTriggerOpen : ""}`}
                aria-expanded={profileOpen}
                aria-haspopup="true"
                onClick={() => {
                  setProfileOpen((open) => !open);
                  setGuideOpen(false);
                }}
              >
                <span className={styles.profileAvatar}>{initial}</span>
                <span className={styles.profileCopy}>
                  <small>{isAdmin ? "Administrator" : "Welcome back"}</small>
                  <strong>{firstName}</strong>
                </span>
                <ChevronIcon />
              </Button>
              {profileOpen ? (
                <div className={styles.profileDropdown}>
                  <div className={styles.profileDropdownHeader}>
                    <span className={styles.profileAvatar}>{initial}</span>
                    <div>
                      <strong>{displayName}</strong>
                      <small>{isAdmin ? "Admin account" : "Customer account"}</small>
                    </div>
                  </div>
                  {showBookingCount ? (
                    <Link
                      href={accountHomeHref}
                      className={`${styles.profileMenuLink} ${styles.profileMenuLinkWithCount}`}
                      aria-label={`${accountHomeLabel}, ${bookingCount} ${bookingCount === 1 ? "booking" : "bookings"}`}
                      onClick={() => setProfileOpen(false)}
                    >
                      <span>{accountHomeLabel}</span>
                      <span className={styles.menuCount} aria-hidden="true">{bookingCount}</span>
                    </Link>
                  ) : (
                    <Link href={accountHomeHref} className={styles.profileMenuLink} onClick={() => setProfileOpen(false)}>{accountHomeLabel}</Link>
                  )}
                  {!isAdmin ? (
                    <Link href={profileHref} className={styles.profileMenuLink} onClick={() => setProfileOpen(false)}>{profileLabel}</Link>
                  ) : null}
                  {!isAdmin ? (
                    <Link href="/account/payments" className={styles.profileMenuLink} onClick={() => setProfileOpen(false)}>Payment History</Link>
                  ) : null}
                   <Button variant="none" className={styles.profileMenuButton} onClick={requestSignOut}>Sign Out</Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.loginActions}>
              {showGuestTracking ? (
                <Link
                  href="/guest/bookings"
                  className={`${styles.guestTrackLink} ${guestTrackingActive ? styles.guestTrackLinkActive : ""}`}
                  aria-current={guestTrackingActive ? "page" : undefined}
                  onClick={closeDropdowns}
                >
                  Track Guest Booking
                </Link>
              ) : null}
              <Link href="/sign-in" className={styles.customerLink}>Login</Link>
            </div>
          )}
        </div>

        <div className={styles.compactActions}>
          <Link
            href="/messages"
            className={styles.compactIcon}
            aria-label="Messages"
          >
            <MessageIcon />
          </Link>
          <Link
            href="/favorites"
            className={styles.compactIcon}
            aria-label={`Favorites${favorites.length ? `, ${favorites.length} saved` : ""}`}
          >
            <HeartIcon />
            {favorites.length > 0 ? <span className={styles.actionCount}>{favorites.length}</span> : null}
          </Link>
          <Link
            href="/cart"
            className={styles.compactIcon}
            aria-label={`Rental cart${totalQuantity ? `, ${totalQuantity} items` : ""}`}
          >
            <CartIcon />
            {totalQuantity > 0 ? <span className={styles.actionCount}>{totalQuantity}</span> : null}
          </Link>
          <Button
            variant="none"
            className={`${styles.menuButton} ${menuOpen ? styles.menuButtonOpen : ""}`}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => {
              setMenuOpen((open) => !open);
              closeDropdowns();
            }}
          >
            <span />
            <span />
            <span />
          </Button>
        </div>
      </div>

      {menuOpen ? (
        <div id="mobile-navigation" className={styles.mobileMenu}>
          <div className={styles.mobileMenuInner}>
            <div className={styles.mobileQuickLinks}>
              <Link href="/messages" onClick={closeMenu}>
                <span className={styles.mobileQuickIcon}><MessageIcon /></span>
                <span><strong>Messages</strong><small>Chat with rental support</small></span>
                <span className={styles.mobileQuickArrow} aria-hidden="true">→</span>
              </Link>
              <Link href="/favorites" onClick={closeMenu}>
                <span className={styles.mobileQuickIcon}><HeartIcon /></span>
                <span><strong>Favorites</strong><small>{favorites.length} saved</small></span>
                <span className={styles.mobileQuickArrow} aria-hidden="true">→</span>
              </Link>
              <Link href="/cart" onClick={closeMenu}>
                <span className={styles.mobileQuickIcon}><CartIcon /></span>
                <span><strong>Rental Cart</strong><small>{totalQuantity} {totalQuantity === 1 ? "item" : "items"}</small></span>
                <span className={styles.mobileQuickArrow} aria-hidden="true">→</span>
              </Link>
              {!isAdmin ? (
                <Button variant="none" className={styles.mobileQuickButton} aria-haspopup="dialog" onClick={openTrackBooking}>
                  <span className={styles.mobileQuickIcon}><TrackIcon /></span>
                  <span><strong>Track Booking</strong><small>Find by booking reference</small></span>
                  <span className={styles.mobileQuickArrow} aria-hidden="true">→</span>
                </Button>
              ) : null}
            </div>

            <nav className={styles.mobileLinks} aria-label="Mobile navigation">
              <p className={styles.mobileLabel}>Explore</p>
              {primaryLinks.map((item) => {
                const active = isPrimaryLinkActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.mobileLink} ${active ? styles.mobileLinkActive : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      closeMenu();
                      handlePrimaryLinkClick(item.href);
                    }}
                  >
                    {item.label}<span aria-hidden="true">→</span>
                  </Link>
                );
              })}
            </nav>

            <nav className={styles.mobileGuide} aria-label="Rental guide navigation">
              <p className={styles.mobileLabel}>Rental Guide</p>
              <div>
                {guideLinks.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.mobileGuideLink} ${active ? styles.mobileGuideLinkActive : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={closeMenu}
                    >
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </Link>
                  );
                })}
              </div>
              <p className={`${styles.mobileLabel} ${styles.mobileGuideSection}`}>Customer Stories &amp; Reviews</p>
              <div>
                {storyLinks.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`${styles.mobileGuideLink} ${active ? styles.mobileGuideLinkActive : ""}`}
                      aria-current={active ? "page" : undefined}
                      onClick={closeMenu}
                    >
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </Link>
                  );
                })}
              </div>
            </nav>

            <div className={styles.mobileAccount}>
              <p className={styles.mobileLabel}>{isAccountHolder ? "Your Account" : "Account"}</p>
              {isAccountHolder ? (
                <>
                  <div className={styles.mobileProfileSummary}>
                    <span className={styles.profileAvatar}>{initial}</span>
                    <div><strong>{displayName}</strong><small>{isAdmin ? "Administrator" : "Customer"}</small></div>
                  </div>
                  <div className={styles.mobileAccountLinks}>
                    <Link href={accountHomeHref} onClick={closeMenu}>{accountHomeLabel}</Link>
                    {!isAdmin ? <Link href="/messages" onClick={closeMenu}>Messages</Link> : null}
                    {!isAdmin ? <Link href={profileHref} onClick={closeMenu}>{profileLabel}</Link> : null}
                    {!isAdmin ? <Link href="/account/payments" onClick={closeMenu}>Payment History</Link> : null}
                     <Button variant="none" onClick={requestSignOut}>Sign Out</Button>
                  </div>
                </>
              ) : (
                <div className={styles.mobileLoginActions}>
                  {showGuestTracking ? (
                    <Link
                      href="/guest/bookings"
                      className={styles.mobileGuestTrackLink}
                      aria-current={guestTrackingActive ? "page" : undefined}
                      onClick={closeMenu}
                    >
                      Track Guest Booking
                    </Link>
                  ) : null}
                  <Link href="/sign-in" onClick={closeMenu}>Login</Link>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
    <div className={styles.navbarSpacer} aria-hidden="true" />
    {/* Rendered outside the header: its backdrop-filter would otherwise trap the fixed overlay. */}
    {signOutConfirmOpen ? (
      <SignOutConfirmModal
        busy={signingOut}
        error={signOutError}
        onConfirm={() => void confirmSignOut()}
        onCancel={() => setSignOutConfirmOpen(false)}
      />
    ) : null}
    {trackBookingOpen ? <TrackBookingModal onClose={() => setTrackBookingOpen(false)} /> : null}
    </>
  );
}
