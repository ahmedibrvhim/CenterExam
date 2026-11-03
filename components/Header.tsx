"use client";
import { useEffect, useState } from "react";
import GeminiKeyModal from "@/components/GeminiKeyModal";
import ThemePicker from "@/components/ThemePicker";
import Emblem from "@/components/Emblem";
import { useAuth } from "@/components/AuthProvider";
import { useAccess } from "@/components/AccessProvider";
import { getSubject, type SubjectId } from "@/lib/subjects";
import { entLabel, isForever, isLow, isTrial, leftText } from "@/lib/plans";

export default function Header({ subject, onChangeSubject }: { subject?: SubjectId | null; onChangeSubject?: () => void }) {
  const s = getSubject(subject);
  const { user, signOut } = useAuth();
  const { openPlans, active, now, isAdmin, order } = useAccess();
  const [keyOpen, setKeyOpen] = useState(false);
  useEffect(() => { const f = () => setKeyOpen(true); window.addEventListener("open-gemini-key", f); return () => window.removeEventListener("open-gemini-key", f); }, []);

  // Subscription state shown in the bar: which subject(s) are open and how long is left.
  const main = active.find((e) => e.subject === "all") ?? [...active].sort((a, b) => b.expiresAt - a.expiresAt)[0];
  const extra = main && main.subject !== "all" ? active.length - 1 : 0;
  const sub = isAdmin ? { cls: "ok", text: "👑 مدير" }
    : main ? { cls: isLow(main, now) ? "warn" : "ok", text: `${isTrial(main) ? "تجربة مجانية · " : ""}${entLabel(main.subject)}${extra ? ` +${extra}` : ""} · ${isForever(main) ? "دائم ∞" : leftText(main, now)}` }
    : order ? { cls: "warn", text: "طلب قيد التفعيل" }
    : { cls: "bad", text: "غير مشترك" };
  const detail = active.length ? active.map((e) => `${entLabel(e.subject)}${isTrial(e) ? " (تجربة)" : ""}: ${isForever(e) ? "دائم" : `متبقٍّ ${leftText(e, now)}`}`).join("\n") : "لا يوجد اشتراك فعّال";
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="brand" aria-label="CenterExam">
          <Emblem size={34} />
          <span className="brand-name" dir="ltr">CenterExam</span>
          <span className="brand-sub">مولّد امتحانات</span>
        </a>
        <p className="site-tagline">حوّل ملفات PDF إلى اختبارات بعدة نسخ</p>
        <ThemePicker />
        {user && (
          <div className="user-chip">
            {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" width={28} height={28} /> : <span className="user-ini" aria-hidden="true">{(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}</span>}
            <span className="user-name">{user.displayName || user.email}</span>
            <button type="button" className="btn-ghost" onClick={signOut}>خروج</button>
          </div>
        )}
        {/* subject + subscription state: same row on a computer, its own scrollable row on a phone */}
        <div className="hdr-row2">
          {s && onChangeSubject && (
            <button type="button" className="subject-chip" onClick={onChangeSubject} aria-label={`المادة الحالية ${s.name} — اضغط للتغيير`}>
              <span aria-hidden="true">{s.icon}</span><b>{s.name}</b><small>تغيير ‹</small>
            </button>
          )}
          <button type="button" className={`sub-status ${sub.cls}`} onClick={() => openPlans(null, "details")} title={detail} aria-label={`حالة الاشتراك: ${sub.text} — اضغط لعرض التفاصيل`}>
            <span className="sub-dot" aria-hidden="true" />{sub.text}
          </button>
          {user && <button type="button" className="btn-ghost" onClick={() => setKeyOpen(true)}>🔑 مفتاح الذكاء الاصطناعي</button>}
          {isAdmin && <a href="/admin" className="btn-ghost hdr-admin">الإدارة</a>}
        </div>
      </div>
      {keyOpen && <GeminiKeyModal onClose={() => setKeyOpen(false)} />}
    </header>
  );
}
