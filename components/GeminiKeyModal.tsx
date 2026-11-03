"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { authFetch } from "@/lib/authFetch";

// Each teacher pastes THEIR OWN free Gemini key here. It is saved encrypted on the server and never shown again (only the last 4 characters).
export default function GeminiKeyModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [last4, setLast4] = useState("");
  const [hasOwn, setHasOwn] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const call = useCallback(async (method: "GET" | "POST" | "DELETE", body?: object) => {
    try {
      const r = await authFetch("/api/gemini-key", { method, cache: "no-store", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, d };
    } catch { return { ok: false, d: { error: "تعذّر الاتصال بالخادم. تحقّق من الإنترنت." } }; }
  }, []);

  useEffect(() => {
    setMounted(true);
    call("GET").then(({ ok, d }) => { if (ok) { setHasOwn(!!d.hasOwn); setLast4(d.last4 || ""); } }).finally(() => setLoading(false));
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [call]);

  const changed = () => window.dispatchEvent(new Event("gemini-key-changed"));

  const save = async () => {
    setBusy(true); setMsg(null);
    const { ok, d } = await call("POST", { key: value.trim() });
    setBusy(false);
    if (!ok) return setMsg({ ok: false, text: d.error || "تعذّر حفظ المفتاح." });
    setHasOwn(true); setLast4(d.last4 || ""); setValue(""); setMsg({ ok: true, text: "تم حفظ مفتاحك. يمكنك الآن توليد الأسئلة." }); changed();
  };
  const remove = async () => {
    if (!confirm("حذف مفتاحك؟ لن تستطيع توليد أسئلة حتى تضيف مفتاحًا جديدًا.")) return;
    setBusy(true); setMsg(null);
    const { ok, d } = await call("DELETE");
    setBusy(false);
    if (!ok) return setMsg({ ok: false, text: d.error || "تعذّر الحذف." });
    setHasOwn(false); setLast4(""); setMsg({ ok: true, text: "تم حذف المفتاح." }); changed();
  };

  if (!mounted) return null;
  // Rendered in <body>, NOT inside the header: the header has backdrop-filter, which traps "position: fixed" children inside the nav bar and breaks the layout.
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="مفتاح الذكاء الاصطناعي" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sub-modal">
        <button type="button" className="sub-x" onClick={onClose} aria-label="إغلاق">✕</button>
        <h2>🔑 مفتاح الذكاء الاصطناعي الخاص بك</h2>
        <p className="hint" style={{ marginTop: 0 }}>كل مدرس يستخدم مفتاح Gemini المجاني الخاص به، فلا يتأثر حدّك اليومي بغيرك.</p>

        {loading ? <p className="hint">جارٍ التحميل…</p> : hasOwn ? (
          <p className="hint" style={{ marginTop: 10 }}>✅ لديك مفتاح محفوظ ينتهي بـ <b dir="ltr">…{last4}</b>. لاستبداله الصق مفتاحًا جديدًا بالأسفل.</p>
        ) : (
          <p className="hint" style={{ marginTop: 10 }}>⚠️ لم تضف مفتاحًا بعد.</p>
        )}

        <h3>كيف تحصل على مفتاح مجاني؟</h3>
        <ol className="hint" style={{ paddingInlineStart: 18, display: "grid", gap: 4, marginTop: 6 }}>
          <li>افتح <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" dir="ltr" style={{ textDecoration: "underline" }}>aistudio.google.com/apikey</a> وسجّل الدخول بحساب Google.</li>
          <li>اضغط <b dir="ltr">Create API key</b> (لا يحتاج بطاقة بنكية).</li>
          <li>انسخ المفتاح كاملًا والصقه هنا.</li>
        </ol>

        <div className="sub-flow">
          <input className="input mono" dir="ltr" type="password" autoComplete="off" spellCheck={false} placeholder="الصق المفتاح هنا" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && value.trim() && !busy) void save(); }} />
          <button type="button" className="btn-primary" disabled={busy || value.trim().length < 8} onClick={save}>{busy ? "جارٍ التحقق…" : hasOwn ? "استبدال المفتاح" : "حفظ المفتاح"}</button>
          {hasOwn && <button type="button" className="btn-ghost" disabled={busy} onClick={remove}>حذف مفتاحي</button>}
          {msg && <p className="hint" role="status" style={{ color: msg.ok ? "#6ee7b7" : "#fca5a5" }}>{msg.text}</p>}
        </div>
        <p className="hint">المفتاح يُحفظ مشفّرًا على الخادم ولا يظهر لأحد، ولا يُرسل إلى الأجهزة الأخرى.</p>
      </div>
    </div>,
    document.body,
  );
}
