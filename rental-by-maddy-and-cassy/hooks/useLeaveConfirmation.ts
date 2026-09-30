"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Marks the duplicate history entry that lets the browser Back button be intercepted. */
const GUARD_STATE_KEY = "__leaveConfirmationGuard";
/** Upper bound on skipping same-URL entries while leaving, so a broken history can never loop. */
const MAX_BACK_STEPS = 10;
/** How long to wait for a Back navigation to start before falling back to `fallbackHref`. */
const BACK_FALLBACK_MS = 700;

type PendingLeave = { kind: "history" } | { kind: "href"; href: string };

interface LeaveConfirmationOptions {
  /** Guard only while true (e.g. an in-progress checkout, not its confirmation screen). */
  enabled: boolean;
  /** Where "Leave" goes when the browser has no earlier page to go back to. */
  fallbackHref: string;
  /** Runs right before leaving, e.g. to flush a debounced progress save. */
  onBeforeLeave?: () => void;
}

function hasGuardEntry(state: unknown): boolean {
  return typeof state === "object" && state !== null && GUARD_STATE_KEY in state;
}

function pushGuardEntry() {
  // Spreading the current state keeps Next.js' router state (__NA / tree) on the
  // duplicate entry, so its popstate handling treats it as the same page.
  const current: unknown = window.history.state;
  const base = typeof current === "object" && current !== null ? current : {};
  window.history.pushState({ ...base, [GUARD_STATE_KEY]: true }, "");
}

/**
 * Asks for confirmation before the visitor leaves the current page through an in-app
 * link, the browser Back button, or a reload/close/typed URL. The last one can only
 * show the browser's built-in prompt; browsers do not allow custom text there.
 */
export function useLeaveConfirmation({ enabled, fallbackHref, onBeforeLeave }: LeaveConfirmationOptions) {
  const router = useRouter();
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const enabledRef = useRef(enabled);
  const leavingRef = useRef(false);
  const guardHrefRef = useRef<string | null>(null);
  const backStepsRef = useRef(0);
  const fallbackTimerRef = useRef<number | null>(null);
  const fallbackHrefRef = useRef(fallbackHref);
  const onBeforeLeaveRef = useRef(onBeforeLeave);

  useEffect(() => {
    enabledRef.current = enabled;
    fallbackHrefRef.current = fallbackHref;
    onBeforeLeaveRef.current = onBeforeLeave;
  });

  const clearFallback = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const goBackOnce = useCallback(() => {
    backStepsRef.current += 1;
    clearFallback();
    // If nothing happens (no earlier page in this tab), leave to the fallback page instead.
    fallbackTimerRef.current = window.setTimeout(() => {
      fallbackTimerRef.current = null;
      router.push(fallbackHrefRef.current);
    }, BACK_FALLBACK_MS);
    window.history.back();
  }, [clearFallback, router]);

  // Add the duplicate entry that the browser Back button lands on first.
  useEffect(() => {
    if (!enabled) return;
    leavingRef.current = false;
    backStepsRef.current = 0;
    if (!hasGuardEntry(window.history.state)) pushGuardEntry();
    guardHrefRef.current = window.location.href;
  }, [enabled]);

  useEffect(() => {
    function handlePopState() {
      const guardHref = guardHrefRef.current;
      if (!guardHref) return;
      const onGuardedUrl = window.location.href === guardHref;

      if (leavingRef.current) {
        if (!onGuardedUrl) {
          clearFallback();
          return;
        }
        // Still on this page (the original entry under the duplicate): keep going back.
        if (backStepsRef.current < MAX_BACK_STEPS) {
          goBackOnce();
        } else {
          clearFallback();
          router.push(fallbackHrefRef.current);
        }
        return;
      }

      // Only react when Back lands on the original (non-duplicate) entry of this page.
      if (!onGuardedUrl || hasGuardEntry(window.history.state)) return;

      if (enabledRef.current) {
        pushGuardEntry();
        setPendingLeave({ kind: "history" });
      } else {
        // Guard was switched off (e.g. booking finished): skip the leftover duplicate entry.
        window.history.back();
      }
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!enabledRef.current || leavingRef.current) {
        clearFallback();
        return;
      }
      event.preventDefault();
      // Legacy browsers need returnValue set to show the prompt.
      event.returnValue = "";
    }

    function handlePageHide() {
      clearFallback();
    }

    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      // Restored from the back/forward cache: re-arm the guard.
      clearFallback();
      leavingRef.current = false;
      backStepsRef.current = 0;
      if (enabledRef.current && !hasGuardEntry(window.history.state)) {
        pushGuardEntry();
        guardHrefRef.current = window.location.href;
      }
    }

    function handleClick(event: MouseEvent) {
      if (!enabledRef.current || leavingRef.current || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      const target = anchor.getAttribute("target");
      if (target && target !== "_self") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      const current = new URL(window.location.href);
      if (url.origin === current.origin && url.pathname === current.pathname && url.search === current.search) {
        return;
      }

      // Capture phase on window runs before Next.js <Link>, so the navigation never starts.
      event.preventDefault();
      event.stopPropagation();
      setPendingLeave({ kind: "href", href: url.href });
    }

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("click", handleClick, true);
      clearFallback();
    };
  }, [clearFallback, goBackOnce, router]);

  const navigateAway = useCallback(
    (href: string) => {
      onBeforeLeaveRef.current?.();
      leavingRef.current = true;
      setPendingLeave(null);
      const url = new URL(href, window.location.href);
      if (url.origin === window.location.origin) {
        router.push(`${url.pathname}${url.search}${url.hash}`);
      } else {
        window.location.assign(url.href);
      }
    },
    [router],
  );

  /** Ask before navigating to `href` (for buttons that navigate without a link). */
  const requestLeave = useCallback(
    (href: string) => {
      if (!enabledRef.current) {
        navigateAway(href);
        return;
      }
      setPendingLeave({ kind: "href", href: new URL(href, window.location.href).href });
    },
    [navigateAway],
  );

  const stay = useCallback(() => setPendingLeave(null), []);

  const confirmLeave = useCallback(() => {
    if (!pendingLeave) return;
    if (pendingLeave.kind === "href") {
      navigateAway(pendingLeave.href);
      return;
    }
    onBeforeLeaveRef.current?.();
    leavingRef.current = true;
    setPendingLeave(null);
    goBackOnce();
  }, [goBackOnce, navigateAway, pendingLeave]);

  return {
    confirmOpen: enabled && pendingLeave !== null,
    stay,
    confirmLeave,
    requestLeave,
  };
}
