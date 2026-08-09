"use client";

import { createContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { subscribeToAuthChanges } from "@/src/services/authService";
import { isActiveAdmin } from "@/src/services/adminService";
import { getUserProfile } from "@/src/services/userService";
import type { UserProfile } from "@/src/types/database";

export interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  loading: boolean;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  isAdmin: false,
  loading: true,
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const activeUserIdRef = useRef<string | null | undefined>(undefined);
  const accountLoadRef = useRef(0);

  async function loadAccountFor(currentUser: User) {
    const [userProfile, adminAccess] = await Promise.all([
      getUserProfile(currentUser.id).catch(() => null),
      isActiveAdmin().catch(() => false),
    ]);
    setProfile(userProfile);
    setIsAdmin(adminAccess);
  }

  useEffect(() => {
    const pendingTimers = new Set<number>();
    const unsubscribe = subscribeToAuthChanges((nextUser) => {
      const nextUserId = nextUser?.id ?? null;
      const identityChanged = activeUserIdRef.current !== nextUserId;
      activeUserIdRef.current = nextUserId;
      setUser(nextUser);

      // Supabase can emit SIGNED_IN/TOKEN_REFRESHED again when a browser tab
      // regains focus. The account has not changed, so do not re-enter the
      // loading gate and unmount customer forms that are already in progress.
      if (!identityChanged) return;

      const loadId = ++accountLoadRef.current;
      setLoading(true);

      // Supabase warns against awaiting other Supabase calls directly inside
      // onAuthStateChange because the shared client can deadlock. Defer the
      // profile and role lookup until the auth callback has fully returned.
      const timerId = window.setTimeout(() => {
        pendingTimers.delete(timerId);
        void (async () => {
          try {
            if (nextUser) {
              const [userProfile, adminAccess] = await Promise.all([
                getUserProfile(nextUser.id).catch(() => null),
                isActiveAdmin().catch(() => false),
              ]);
              if (loadId === accountLoadRef.current) {
                setProfile(userProfile);
                setIsAdmin(adminAccess);
              }
            } else {
              setProfile(null);
              setIsAdmin(false);
            }
          } catch {
            setProfile(null);
            setIsAdmin(false);
          } finally {
            if (loadId === accountLoadRef.current) setLoading(false);
          }
        })();
      }, 0);
      pendingTimers.add(timerId);
    });

    return () => {
      unsubscribe();
      pendingTimers.forEach((timerId) => window.clearTimeout(timerId));
      pendingTimers.clear();
    };
  }, []);

  async function refreshProfile() {
    if (user) {
      await loadAccountFor(user);
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}
