"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, type User } from "firebase/auth";
import { firebaseConfigured, getFirebaseAuth, googleProvider } from "@/lib/firebase";

type Status = "loading" | "signedOut" | "signedIn";
type Ctx = { user: User | null; status: Status; busy: boolean; error: string; configured: boolean; signIn: () => Promise<void>; signOut: () => Promise<void> };

const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
};

// Arabic messages for the errors a student can actually hit.
function explain(code: string): string {
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return ""; // the user just closed the window: not an error
    case "auth/network-request-failed": return "لا يوجد اتصال بالإنترنت. تحقّق من الشبكة وحاول مجددًا.";
    case "auth/unauthorized-domain": return "هذا النطاق غير مُصرّح به في Firebase (Authentication ← Settings ← Authorized domains).";
    case "auth/operation-not-allowed": return "تسجيل الدخول بـ Google غير مُفعّل في Firebase (Authentication ← Sign-in method).";
    case "auth/user-disabled": return "تم إيقاف هذا الحساب.";
    case "auth/too-many-requests": return "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.";
    default: return "تعذّر تسجيل الدخول. حاول مرة أخرى.";
  }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setStatus("signedOut"); return; }
    getRedirectResult(auth).catch((e) => setError(explain(e?.code || ""))); // finishes a redirect sign-in (popup fallback)
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setStatus(u ? "signedIn" : "signedOut");
      if (u) { setError(""); setBusy(false); }
    });
  }, []);

  const signIn = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) { setError("لم يتم ربط Firebase بعد. أضف متغيرات NEXT_PUBLIC_FIREBASE_* ثم أعد التشغيل."); return; }
    setBusy(true); setError("");
    try {
      await signInWithPopup(auth, googleProvider());
    } catch (e: any) {
      if (e?.code === "auth/popup-blocked") {
        try { await signInWithRedirect(auth, googleProvider()); return; } catch (e2: any) { setError(explain(e2?.code || "")); }
      } else setError(explain(e?.code || ""));
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await fbSignOut(auth);
    try { sessionStorage.removeItem("centerapp-splash-seen"); } catch {} // next login plays the intro again
    document.documentElement.removeAttribute("data-splash");
  }, []);

  const value = useMemo(() => ({ user, status, busy, error, configured: firebaseConfigured, signIn, signOut }), [user, status, busy, error, signIn, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
