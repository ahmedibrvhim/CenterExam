"use client";
import { useEffect, useRef, useState } from "react";
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
  const [menu, setMenu] = useState(false);               // the account menu (avatar): key, admin, sign out
  const acct = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!acct.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", away as EventListener); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away as EventListener); document.removeEventListener("keydown", esc); };
  }, [menu]);
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
          <div className="acct" ref={acct}>
            <button type="button" className="acct-btn" aria-label="حسابي" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
              {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" width={30} height={30} /> : <span className="user-ini" aria-hidden="true">{(user.displayName || user.email || "?").slice(0, 1).toUpperCase()}</span>}
            </button>
            {menu && (
              <div className="acct-menu" role="menu">
                <div className="acct-who"><b>{user.displayName || "حسابي"}</b>{user.email ? <small dir="ltr">{user.email}</small> : null}</div>
                <button type="button" role="menuitem" className="acct-item" onClick={() => { setMenu(false); setKeyOpen(true); }}>🔑 مفتاح Gemini</button>
                {isAdmin && <a role="menuitem" href="/admin" className="acct-item">👑 الإدارة</a>}
                <button type="button" role="menuitem" className="acct-item danger" onClick={() => { setMenu(false); signOut(); }}>⎋ تسجيل الخروج</button>
              </div>
            )}
          </div>
        )}
        {/* subject + subscription state: same row on a computer, its own scrollable row on a phone */}
        <div className="hdr-row2">
          {s && onChangeSubject && (
            <>
              <button type="button" className="back-btn" onClick={onChangeSubject} aria-label="الرجوع إلى كل المواد">→ كل المواد</button>
              <span className="subject-now" aria-label={`المادة الحالية ${s.name}`}><span aria-hidden="true">{s.icon}</span>{s.name}</span>
            </>
          )}
          <button type="button" className={`sub-status ${sub.cls}`} onClick={() => openPlans(null, "details")} title={detail} aria-label={`حالة الاشتراك: ${sub.text} — اضغط لعرض التفاصيل`}>
            <span className="sub-dot" aria-hidden="true" /><span className="sub-txt">{sub.text}</span>
          </button>
        </div>
      </div>
      {keyOpen && <GeminiKeyModal onClose={() => setKeyOpen(false)} />}
    </header>
  );
}
