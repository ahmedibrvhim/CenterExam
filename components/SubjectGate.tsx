"use client";
import { SUBJECTS, type SubjectId } from "@/lib/subjects";
import { useAccess } from "@/components/AccessProvider";
import { isForever, leftText, paidCover } from "@/lib/plans";

// Shown before the tool opens: the teacher picks the subject, and the tool then adapts its inputs (question types, counts, AI rules).
export default function SubjectGate({ onPick }: { onPick: (id: SubjectId) => void }) {
  const { can, openPlans, lapsed, entitlements, now, isAdmin, trialEnded } = useAccess();
  return (
    <section className="gate" aria-labelledby="gate-title">
      <div className="gate-head">
        <h2 id="gate-title">اختر المادة</h2>
        <p>تتغيّر إعدادات الأداة وأنواع الأسئلة حسب المادة، ليكتب الذكاء الاصطناعي أسئلة أدقّ.</p>
      </div>
      {trialEnded && !isAdmin && (
        <div className="ai-status bad" role="alert" style={{ marginBottom: 14 }}>
          <span className="dot" />
          <div>
            <strong>🎁 انتهت التجربة المجانية</strong>
            <small>تم تنزيل ملف PDF الأول فانتهت التجربة وأُغلقت المواد. اختر مادة بالأسفل (أو كل المواد) للاشتراك والمتابعة.</small>
          </div>
        </div>
      )}
      <div className="gate-grid">
        {SUBJECTS.map((s, i) => {
          const ok = can(s.id);
          const paid = isAdmin ? undefined : paidCover(entitlements, s.id, now);   // running paid subscription: shown as active, nothing to renew
          return (
          <button key={s.id} type="button" className={`gate-card${s.ready ? " ready" : ""}${ok ? "" : " locked"}`} style={{ animationDelay: `${i * 70}ms` }} onClick={() => (ok ? onPick(s.id) : openPlans(s.id))}>
            <span className="gate-ico" aria-hidden="true">{s.icon}</span>
            <span className="gate-name">{s.name}</span>
            <span className="gate-tag">{s.tagline}</span>
            {!ok ? <span className="gate-badge">{trialEnded ? "🔒 انتهت التجربة المجانية — اضغط للاشتراك" : lapsed(s.id) ? "🔒 انتهى اشتراكك — اضغط للتجديد" : "🔒 اضغط للاشتراك في هذه المادة"}</span> : paid ? <span className="gate-badge ok">✓ مشترك · {isForever(paid) ? "دائم ∞" : `متبقٍّ ${leftText(paid, now)}`}</span> : s.ready ? <span className="gate-badge ok">أنواع أسئلة مخصّصة</span> : <span className="gate-badge">أنواع عامة · التخصيص قريبًا</span>}
          </button>
          );
        })}
      </div>
    </section>
  );
}
