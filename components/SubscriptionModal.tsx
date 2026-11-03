"use client";
import { useEffect } from "react";
import { useAccess } from "@/components/AccessProvider";
import SubscribeFlow from "@/components/SubscribeFlow";
import { TERM_LABEL, entLabel, isForever, isLow, leftText, termOf } from "@/lib/plans";
import { getSubject } from "@/lib/subjects";

// "اشتراكي": my active subscriptions + the prices + a box to activate another code (also opened by tapping a locked subject).
export default function SubscriptionModal() {
  const { active, now, closePlans, order, isAdmin, plansSubject, lapsed } = useAccess();
  const one = plansSubject ? getSubject(plansSubject) : null;   // opened from a subject: show only that subject
  const mine = one ? active.filter((e) => e.subject === one.id || e.subject === "all") : active;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closePlans(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [closePlans]);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="اشتراكي" onMouseDown={(e) => { if (e.target === e.currentTarget) closePlans(); }}>
      <div className="sub-modal">
        <button type="button" className="sub-x" onClick={closePlans} aria-label="إغلاق">✕</button>
        <h2>{one ? `اشتراكي — ${one.name}` : "اشتراكي"}</h2>
        {isAdmin ? <p className="hint">👑 حساب المدير مفتوح على كل المواد بدون اشتراك ولا نهاية.</p> : <>
        {mine.length ? (
          <ul className="sub-list">
            {mine.map((e) => (
              <li key={e.subject}><b>{entLabel(e.subject)}</b><span className="sub-meta"><span className="pill">{TERM_LABEL[termOf(e)]}</span><span className={`pill ${isLow(e, now) ? "warn" : "ok"}`}>{isForever(e) ? "دائم ∞" : `متبقٍّ ${leftText(e, now)}`}</span></span></li>
            ))}
          </ul>
        ) : <p className="hint">{one && lapsed(one.id) ? `انتهى اشتراكك في ${one.name}. جدّد من الأسفل لفتحها من جديد.` : one ? `لا يوجد اشتراك فعّال في ${one.name}.` : "لا يوجد اشتراك فعّال حاليًا."}</p>}
        <h3>{order ? "طلبك الحالي" : mine.length ? "تجديد / إضافة أيام" : "اشتراك"}</h3>
        <SubscribeFlow onDone={closePlans} subject={one?.id ?? null} />
        <p className="hint">الشهري 30 يومًا والسنوي 365 يومًا من لحظة التفعيل، وتفعيل كود جديد لنفس المادة يُضيف المدة بعد انتهاء الحالية. الاشتراك الدائم لا ينتهي، والتجربة المجانية ساعة واحدة مرة لكل مستخدم.</p>
        </>}
      </div>
    </div>
  );
}
