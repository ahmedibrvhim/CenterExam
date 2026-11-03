"use client";
import { useEffect, useState, type ReactNode } from "react";
import Emblem from "@/components/Emblem";
import ThemePicker from "@/components/ThemePicker";
import SubscribeFlow from "@/components/SubscribeFlow";
import { useAuth } from "@/components/AuthProvider";
import { useAccess } from "@/components/AccessProvider";

// true once the intro animation is over (Splash marks <html data-splash="done">)
function useSplashDone() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const check = () => setDone(el.getAttribute("data-splash") === "done");
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { attributes: true, attributeFilter: ["data-splash"] });
    return () => mo.disconnect();
  }, []);
  return done;
}

function Shell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  const { signOut } = useAuth();
  return (
    <main className="login" dir="rtl">
      <div className="login-top"><ThemePicker /></div>
      <section className="login-card wide">
        <div className="login-emblem"><Emblem size={64} /></div>
        <h1 className="login-name sm" dir="ltr">CenterExam</h1>
        <h2 className="gate-step">{title}</h2>
        {lead && <p className="login-lead">{lead}</p>}
        {children}
        <button type="button" className="btn-ghost login-out" onClick={signOut}>تسجيل الخروج</button>
      </section>
    </main>
  );
}

function ProfileForm() {
  const { saveProfile } = useAccess();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    const m = await saveProfile(name, phone);
    setBusy(false);
    if (m) setErr(m);
  };
  return (
    <Shell title="بيانات المدرس" lead="اكتب بياناتك مرة واحدة لنتمكن من التواصل معك وإرسال كود الاشتراك.">
      <form className="gate-form" onSubmit={submit}>
        <div className="field"><label htmlFor="t-name">اسم المدرس</label><input id="t-name" className="input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أ/ أحمد محمد" autoFocus /></div>
        <div className="field"><label htmlFor="t-phone">رقم الهاتف</label><input id="t-phone" className="input" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" /></div>
        {err && <p className="login-err" role="alert">{err}</p>}
        <button type="submit" className="btn-primary" disabled={busy || name.trim().length < 2 || phone.trim().length < 8}>{busy ? "جاري الحفظ…" : "متابعة"}</button>
      </form>
    </Shell>
  );
}

function Activation() {
  const { entitlements } = useAccess();
  const expired = entitlements.length > 0;
  return (
    <Shell title={expired ? "انتهى اشتراكك" : "الاشتراك في CenterExam"} lead="اختر الاشتراك وحوّل المبلغ، ثم أدخل الكود الذي يصلك للدخول إلى الأداة.">
      <SubscribeFlow />
    </Shell>
  );
}

// After the intro: teacher info -> subscription code -> the tool. Admins skip the code.
export default function AccessGate({ children }: { children: ReactNode }) {
  const splashDone = useSplashDone();
  const { status, error, profile, active, isAdmin, refresh } = useAccess();
  const { signOut } = useAuth();
  if (!splashDone) return null;
  if (status === "loading") return <div className="login login-loading" role="status" aria-label="جاري التحميل"><span className="login-spin big" /></div>;
  if (status === "error") return (
    <Shell title="تعذّر تحميل حسابك" lead={error}>
      <button type="button" className="btn-primary" onClick={refresh}>إعادة المحاولة</button>
    </Shell>
  );
  if (!profile) return <ProfileForm />;
  if (!isAdmin && active.length === 0) return <Activation />;
  return <>{children}</>;
}
