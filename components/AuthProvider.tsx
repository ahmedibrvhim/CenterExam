"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signInWithCredential, GoogleAuthProvider, getRedirectResult, signOut as fbSignOut, type User } from "firebase/auth";
import { firebaseConfigured, getFirebaseAuth, googleProvider } from "@/lib/firebase";

type Status = "loading" | "signedOut" | "signedIn";
type Ctx = { user: User | null; status: Status; busy: boolean; error: string; stuck: boolean; configured: boolean; signIn: () => Promise<void>; signInWithGoogleToken: (idToken: string) => Promise<void>; signOut: () => Promise<void>; resetLogin: () => void };

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
    case "auth/web-storage-unsupported": return "هذا المتصفح يمنع التخزين اللازم لتسجيل الدخول (غالبًا متصفح داخل تطبيق). افتح الرابط في Chrome أو Safari.";
    case "auth/internal-error": return "تعذّر إكمال تسجيل الدخول داخل هذا المتصفح. افتح الرابط في Chrome أو Safari ثم حاول مجددًا.";
    default: return "تعذّر تسجيل الدخول. حاول مرة أخرى.";
  }
}

const STUCK_MS = 25_000;   // a sign-in that does not answer after this long is treated as stuck
const LOADING_MS = 8_000;  // the first answer of Firebase ("am I signed in?") should come much sooner than this

// What Firebase leaves in the browser while a sign-in is half done. If a redirect/popup was cut off (in-app browser, closed tab...) these stay
// behind and the next visit tries to finish the old sign-in again: that is why "cleaning the tab" used to fix it.
function clearPendingAuth() {
  try { for (const k of Object.keys(sessionStorage)) if (/^firebase:(pendingRedirect|authEvent)/.test(k)) sessionStorage.removeItem(k); } catch {}
}
function hasPendingAuth() {
  try { return Object.keys(sessionStorage).some((k) => /^firebase:pendingRedirect/.test(k)); } catch { return false; }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stuck, setStuck] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disarm = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  // if the sign-in never answers (typical inside the WhatsApp / Facebook in-app browser) stop the spinner and say what to do
  const arm = () => {
    disarm();
    timer.current = setTimeout(() => {
      setBusy(false); setStuck(true);
      setError("استغرق تسجيل الدخول وقتًا طويلًا. إن فتحت الرابط من واتساب أو تطبيق آخر فافتحه في Chrome أو Safari، أو اضغط «إعادة ضبط تسجيل الدخول».");
    }, STUCK_MS);
  };

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) { setStatus("signedOut"); return; }
    // never wait for ever on the first answer (a browser that blocks storage can leave Firebase silent): show the login page instead
    const first = setTimeout(() => setStatus((s) => (s === "loading" ? "signedOut" : s)), LOADING_MS);
    // finish a redirect sign-in only when one was really started; an old half-finished one is thrown away instead of blocking every visit
    if (hasPendingAuth()) getRedirectResult(auth).catch((e) => { clearPendingAuth(); setError(explain(e?.code || "")); });
    const off = onAuthStateChanged(auth, (u) => {
      clearTimeout(first);
      setUser(u);
      setStatus(u ? "signedIn" : "signedOut");
      if (u) { setError(""); setBusy(false); setStuck(false); disarm(); }
    });
    return () => { clearTimeout(first); off(); disarm(); };
  }, []);

  const signIn = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (!auth) { setError("لم يتم ربط Firebase بعد. أضف متغيرات NEXT_PUBLIC_FIREBASE_* ثم أعد التشغيل."); return; }
    setBusy(true); setError(""); setStuck(false); clearPendingAuth(); arm();
    try {
      await signInWithPopup(auth, googleProvider());
    } catch (e: any) {
      if (e?.code === "auth/popup-blocked") {
        try { await signInWithRedirect(auth, googleProvider()); return; } catch (e2: any) { setError(explain(e2?.code || "")); }
      } else setError(explain(e?.code || ""));
      disarm(); setBusy(false);
    }
  }, []);

  // Google's own button hands us an ID token directly: no redirect, no popup, no sessionStorage round trip (the thing iOS Safari loses).
  const signInWithGoogleToken = useCallback(async (idToken: string) => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    setBusy(true); setError(""); setStuck(false); arm();
    try { await signInWithCredential(auth, GoogleAuthProvider.credential(idToken)); }
    catch (e: any) { setError(explain(e?.code || "")); disarm(); setBusy(false); }
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await fbSignOut(auth);
    try { sessionStorage.removeItem("centerapp-splash-seen"); sessionStorage.removeItem("centerapp-subject"); } catch {} // next login plays the intro again
    document.documentElement.removeAttribute("data-splash");
  }, []);

  // "clean the tab" in one tap: forget everything Firebase and the app saved in this browser, then start again
  const resetLogin = useCallback(() => {
    try { for (const st of [sessionStorage, localStorage]) for (const k of Object.keys(st)) if (/^firebase:|^centerapp-(splash|subject)/.test(k)) st.removeItem(k); } catch {}
    try { indexedDB.deleteDatabase("firebaseLocalStorageDb"); } catch {}
    location.reload();
  }, []);

  const value = useMemo(() => ({ user, status, busy, error, stuck, configured: firebaseConfigured, signIn, signInWithGoogleToken, signOut, resetLogin }), [user, status, busy, error, stuck, signIn, signInWithGoogleToken, signOut, resetLogin]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
