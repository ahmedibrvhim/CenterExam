"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authFetch } from "@/lib/authFetch";
import { activeOf, covers, type Entitlement, type OrderDoc, type Plan } from "@/lib/plans";
import { useNow } from "@/components/useNow";
import SubscriptionModal from "@/components/SubscriptionModal";

type Profile = { name: string; phone: string };
type Status = "loading" | "ready" | "error";
type Ctx = {
  status: Status; error: string; everSubscribed: boolean; profile: Profile | null; entitlements: Entitlement[]; isAdmin: boolean; now: number;
  order: OrderDoc | null;                      // my open order (placed, not activated yet) - drives the payment gateway
  active: Entitlement[];                       // not expired yet
  can: (subject: string) => boolean;           // may this person use the subject right now (admins: always)
  refresh: () => Promise<void>;
  saveProfile: (name: string, phone: string) => Promise<string>;   // returns "" or an error message
  redeem: (code: string) => Promise<string>;                       // returns "" or an error message
  createOrder: (o: { name: string; phone: string; plan: Plan; subject?: string }) => Promise<string>;   // "make subscription": returns "" or an error message
  cancelOrder: () => Promise<string>;
  plansOpen: boolean; plansSubject: string | null; openPlans: (subject?: string | null) => void; closePlans: () => void;
  lapsed: (subject: string) => boolean;        // had this subject (or all) before and it has ended
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
  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);
  const [plansSubject, setPlansSubject] = useState<string | null>(null);
  const [ever, setEver] = useState(false);
  const tick = useNow(30_000); // subscriptions end by themselves while the page is open
  const [skew, setSkew] = useState(0); // server clock - browser clock
  // read the clock again whenever the data changes (a stale 30s-old "now" made a fresh 30-day code show 31)
  const now = useMemo(() => Date.now() + skew, [tick, skew, entitlements]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const { ok, data } = await call("/api/me");
    if (!ok) { setError(data.error || "تعذّر تحميل بيانات حسابك."); setStatus((s) => (s === "ready" ? s : "error")); return; }
    setProfile(data.profile); setEnts(data.entitlements ?? []); setAdmin(!!data.isAdmin); setEver(!!data.everSubscribed); setOrder(data.order ?? null); if (data.now) setSkew(data.now - Date.now()); setError(""); setStatus("ready");
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
    if (data.now) setSkew(data.now - Date.now()); setEnts(data.entitlements ?? []); setEver(true); setOrder(null); refresh(); return "";
  }, [refresh]);

  const createOrder = useCallback(async (o: { name: string; phone: string; plan: Plan; subject?: string }) => {
    const { ok, data } = await call("/api/orders", o);
    if (!ok) return data.error || "تعذّر إنشاء الطلب.";
    setProfile(data.profile); setOrder(data.order); return "";
  }, []);

  const cancelOrder = useCallback(async () => {
    if (!order) return "";
    try {
      const r = await authFetch("/api/orders", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: order.id, action: "cancel" }), cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return data.error || "تعذّر إلغاء الطلب.";
    } catch { return "تعذّر الاتصال بالخادم."; }
    setOrder(null); return "";
  }, [order]);

  const value = useMemo<Ctx>(() => ({
    status, error, everSubscribed: ever || entitlements.length > 0, profile, entitlements, isAdmin, now, order,
    active: activeOf(entitlements, now),
    can: (subject: string) => isAdmin || covers(entitlements, subject, now),
    refresh, saveProfile, redeem, createOrder, cancelOrder,
    plansOpen, plansSubject, openPlans: (s?: string | null) => { setPlansSubject(s ?? null); setPlansOpen(true); }, closePlans: () => setPlansOpen(false),
    lapsed: (subject: string) => entitlements.some((e) => (e.subject === "all" || e.subject === subject) && e.expiresAt <= now),
  }), [status, error, profile, entitlements, isAdmin, now, order, refresh, saveProfile, redeem, createOrder, cancelOrder, plansOpen, plansSubject, ever]);

  return <C.Provider value={value}>{children}{plansOpen && status === "ready" && <SubscriptionModal />}</C.Provider>;
}
