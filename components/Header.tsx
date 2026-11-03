"use client";
import ThemePicker from "@/components/ThemePicker";
import Emblem from "@/components/Emblem";
import { useAuth } from "@/components/AuthProvider";
import { useAccess } from "@/components/AccessProvider";
import { getSubject, type SubjectId } from "@/lib/subjects";

export default function Header({ subject, onChangeSubject }: { subject?: SubjectId | null; onChangeSubject?: () => void }) {
  const s = getSubject(subject);
  const { user, signOut } = useAuth();
  const { openPlans } = useAccess();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="brand" aria-label="CenterExam">
          <Emblem size={34} />
          <span className="brand-name" dir="ltr">CenterExam</span>
          <span className="brand-sub">مولّد امتحانات</span>
        </a>
        <p className="site-tagline">حوّل ملفات PDF إلى اختبارات بعدة نسخ</p>
        {s && onChangeSubject && (
          <button type="button" className="subject-chip" onClick={onChangeSubject} aria-label={`المادة الحالية ${s.name} — اضغط للتغيير`}>
            <span aria-hidden="true">{s.icon}</span><b>{s.name}</b><small>تغيير ‹</small>
          </button>
        )}
        <ThemePicker />
        <button type="button" className="btn-ghost" onClick={openPlans}>اشتراكي</button>
        {user && (
          <div className="user-chip">
            {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" width={28} height={28} /> : <span className="user-ini" aria-hidden="true">{(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}</span>}
            <span className="user-name">{user.displayName || user.email}</span>
            <button type="button" className="btn-ghost" onClick={signOut}>خروج</button>
          </div>
        )}
      </div>
    </header>
  );
}
