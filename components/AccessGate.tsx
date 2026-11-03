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

// Gateway after login (teachers without an active subscription):
//   no open order -> order gateway (name / phone / subscription -> "إنشاء الاشتراك")
//   open order    -> payment gateway (how to pay + enter the code)
function Activation() {
  const { entitlements, order } = useAccess();
  const expired = entitlements.length > 0;
  return order ? (
    <Shell title="إتمام الدفع وتفعيل الاشتراك" lead="حوّل المبلغ وأرسل صورة التحويل، ثم أدخل الكود الذي يصلك لفتح الأداة.">
      <SubscribeFlow />
    </Shell>
  ) : (
    <Shell title={expired ? "انتهى اشتراكك — جدّد الآن" : "الاشتراك في CenterExam"} lead="اكتب اسمك أو اسم السنتر ورقم الهاتف، ثم اختر الاشتراك المناسب.">
      <SubscribeFlow />
    </Shell>
  );
}

// After the intro: order gateway -> payment + code gateway -> the tool. Admins skip all of it.
export default function AccessGate({ children }: { children: ReactNode }) {
  const splashDone = useSplashDone();
  const { status, error, entitlements, isAdmin, refresh } = useAccess();
  const { signOut } = useAuth();
  if (!splashDone) return null;
  if (status === "loading") return <div className="login login-loading" role="status" aria-label="جاري التحميل"><span className="login-spin big" /></div>;
  if (status === "error") return (
    <Shell title="تعذّر تحميل حسابك" lead={error}>
      <button type="button" className="btn-primary" onClick={refresh}>إعادة المحاولة</button>
    </Shell>
  );
  // the order / payment gateway is only for a person who never had a subscription; after it ends they still enter the tool and renew from «اشتراكي»
  if (!isAdmin && entitlements.length === 0) return <Activation />;
  return <>{children}</>;
}
