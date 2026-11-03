"use client";
import { useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { formatCode, normalizeCode } from "@/lib/plans";

// Code entry box (used on the activation screen and inside "اشتراكي").
export default function CodeForm({ onDone, autoFocus }: { onDone?: () => void; autoFocus?: boolean }) {
  const { redeem } = useAccess();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr("");
    const m = await redeem(val);
    setBusy(false);
    if (m) { setErr(m); return; }
    setOk(true); setVal("");
    onDone?.();
  };

  return (
    <form className="code-form" onSubmit={submit}>
      <label htmlFor="sub-code">كود الاشتراك</label>
      <div className="code-row">
        <input id="sub-code" className="input code-input" dir="ltr" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus={autoFocus}
          placeholder="CX-XXXX-XXXX-XXXX" value={val}
          onChange={(e) => { const n = normalizeCode(e.target.value).slice(0, 14); setVal(n.length > 2 ? formatCode(n.padEnd(14, "\u0000")).replace(/\u0000/g, "").replace(/-+$/, "") : n); setErr(""); setOk(false); }} />
        <button type="submit" className="btn-primary" disabled={busy || normalizeCode(val).length < 14}>{busy ? "جاري التفعيل…" : "تفعيل"}</button>
      </div>
      {err && <p className="login-err" role="alert">{err}</p>}
      {ok && <p className="code-ok" role="status">✓ تم تفعيل الاشتراك بنجاح</p>}
    </form>
  );
}
