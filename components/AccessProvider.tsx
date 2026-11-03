"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authFetch } from "@/lib/authFetch";
import { activeOf, covers, type Entitlement } from "@/lib/plans";
import { useNow } from "@/components/useNow";
import SubscriptionModal from "@/components/SubscriptionModal";

type Profile = { name: string; phone: string };
type Status = "loading" | "ready" | "error";
type Ctx = {
  status: Status; error: string; profile: Profile | null; entitlements: Entitlement[]; isAdmin: boolean; now: number;
  active: Entitlement[];                       // not expired yet
  can: (subject: string) => boolean;           // may this person use the subject right now (admins: always)
  refresh: () => Promise<void>;
  saveProfile: (name: string, phone: string) => Promise<string>;   // returns "" or an error message
  redeem: (code: string) => Promise<string>;                       // returns "" or an error message
  plansOpen: boolean; openPlans: () => void; closePlans: () => void;
};
const C = createContext<Ctx | null>(null);
export const useAccess = () => { const c = useContext(C); if (!c) throw new Error("useAccess must be used inside <AccessProvider>"); return c; };

async function call(url: string, body?: object): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await authFetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok && !data.error) data.error = `تعذّر الاتصال بالخادم (رمز ${r.status}). تأكد من إضافة متغيرات Vercel ثم أعد النشر.`;
    return { ok: r.ok, data };
  } catch { return { ok: false, data: { code: "network", error: "تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى." } }; }
}

export default function AccessProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entitlements, setEnts] = useState<Entitlement[]>([]);
  const [isAdmin, setAdmin] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const now = useNow(30_000); // subscriptions end by themselves while the page is open

  const refresh = useCallback(async () => {
    const { ok, data } = await call("/api/me");
    if (!ok) { setError(data.error || "تعذّر تحميل بيانات حسابك."); setStatus((s) => (s === "ready" ? s : "error")); return; }
    setProfile(data.profile); setEnts(data.entitlements ?? []); setAdmin(!!data.isAdmin); setError(""); setStatus("ready");
  }, []);

  useEffect(() => {
    refresh();
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  const saveProfile = useCallback(async (name: string, phone: string) => {
    const { ok, data } = await call("/api/profile", { name, phone });
    if (!ok) return data.error || "تعذّر حفظ البيانات.";
    setProfile(data.profile); return "";
  }, []);

  const redeem = useCallback(async (code: string) => {
    const { ok, data } = await call("/api/redeem", { code });
    if (!ok) return data.error || "تعذّر تفعيل الكود.";
    setEnts(data.entitlements ?? []); return "";
  }, []);

  const value = useMemo<Ctx>(() => ({
    status, error, profile, entitlements, isAdmin, now,
    active: activeOf(entitlements, now),
    can: (subject: string) => isAdmin || covers(entitlements, subject, now),
    refresh, saveProfile, redeem,
    plansOpen, openPlans: () => setPlansOpen(true), closePlans: () => setPlansOpen(false),
  }), [status, error, profile, entitlements, isAdmin, now, refresh, saveProfile, redeem, plansOpen]);

  return <C.Provider value={value}>{children}{plansOpen && status === "ready" && <SubscriptionModal />}</C.Provider>;
}
