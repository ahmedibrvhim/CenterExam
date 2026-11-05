"use client";
import { useEffect } from "react";
import { useAccess } from "@/components/AccessProvider";
import SubscribeFlow from "@/components/SubscribeFlow";
import { TERM_LABEL, entLabel, isForever, isLow, leftText, termOf } from "@/lib/plans";
import { getSubject } from "@/lib/subjects";

// Two ways to open it:
//   "details"   (the subscription button in the header): ONLY shows my subscriptions and what is left. No renewal, no order form.
//   "subscribe" (tapping a locked subject on the subjects page): that subject's order / payment / code flow. A subject that is still
//               covered by a running paid subscription never reaches this screen (and the server refuses it too).
export default function SubscriptionModal() {
  const { active, now, closePlans, order, isAdmin, plansSubject, plansMode, lapsed } = useAccess();
  const details = plansMode === "details";
  const one = !details && plansSubject ? getSubject(plansSubject) : null;   // opened from a subject: show only that subject
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

        {details ? <>
          {order && <p className="hint">لديك طلب رقم #{order.ref} قيد التفعيل. لإكمال الدفع أو إدخال الكود افتح مادة مقفلة من صفحة المواد.</p>}
          <p className="hint">الاشتراك لا يُجدَّد ولا يُشترى من جديد قبل انتهائه. عند انتهاء مادة تظهر مقفلة في صفحة المواد، وتجدّدها من هناك.</p>
        </> : <>
          <h3>{order ? "طلبك الحالي" : "اشتراك"}</h3>
          {order && one && order.plan === "single" && order.subject !== one.id && <p className="login-err" role="status">طلبك الحالي لمادة «{entLabel(order.subject)}» فقط، وكوده لن يفتح {one.name}. لطلب {one.name} ألغِ الطلب الحالي أولًا من الأسفل.</p>}
          <SubscribeFlow onDone={closePlans} subject={one?.id ?? null} />
          <p className="hint">الشهري 30 يومًا والسنوي 365 يومًا من لحظة التفعيل. الاشتراك الدائم لا ينتهي، والتجربة المجانية ملف PDF واحد مرة لكل مستخدم.</p>
        </>}
        </>}
      </div>
    </div>
  );
}
