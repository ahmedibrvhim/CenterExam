"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAccess } from "@/components/AccessProvider";

// Edit the teacher's name and phone. They are printed in the footer of every page of the exam PDFs (the footer is built when the PDF is made,
// so the new values are used from the next download, also for exams that were created before the change).
export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, saveProfile } = useAccess();
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const valid = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 8;
  const unchanged = name.trim() === (profile?.name ?? "") && phone.trim() === (profile?.phone ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setMsg(null);
    const err = await saveProfile(name, phone);
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: "تم الحفظ. سيظهر الاسم والرقم الجديدان في ذيل ملفات PDF من الآن." });
  };

  if (!mounted) return null;
  // in <body> (not inside the header): the header has backdrop-filter, which would trap a fixed dialog inside the nav bar
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="بياناتي" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="sub-modal" onSubmit={save}>
        <button type="button" className="sub-x" onClick={onClose} aria-label="إغلاق">✕</button>
        <h2>✏️ بياناتي</h2>
        <p className="hint" style={{ marginTop: 0 }}>الاسم ورقم الهاتف يظهران في أسفل كل صفحة من ملفات PDF للاختبارات.</p>
        <div className="field"><label htmlFor="p-name">اسم المدرس أو السنتر</label><input id="p-name" className="input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أ/ أحمد محمد أو سنتر النور" /></div>
        <div className="field"><label htmlFor="p-phone">رقم الهاتف</label><input id="p-phone" className="input" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" /></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" className="btn-primary" disabled={busy || !valid || unchanged}>{busy ? "جارٍ الحفظ…" : "حفظ التعديل"}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>إغلاق</button>
        </div>
        {msg && <p className="hint" role="status" style={{ color: msg.ok ? "#6ee7b7" : "#fca5a5" }}>{msg.text}</p>}
      </form>
    </div>,
    document.body,
  );
}
