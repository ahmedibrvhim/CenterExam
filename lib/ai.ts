import type { Q } from "@/exam";
import { authFetch } from "@/lib/authFetch";

export type Fail = { code: string; message: string; retryAfter?: number };

// The server tries several Gemini models. This remembers (in this browser tab) which one answered last time, and which ones stalled or were busy
// in the last minutes, and sends both with the next request: the server then starts with the model that works and skips the slow ones,
// instead of spending 15 s on each broken model at every single request (that is what made the whole exam end in "timeout").
const MEMO_KEY = "ce_model_memo";
const SLOW_MS = 8 * 60_000;
type Memo = { good: string | null; slow: Record<string, number> };
function loadMemo(): Memo {
  try { const m = JSON.parse(sessionStorage.getItem(MEMO_KEY) || "null"); if (m && typeof m === "object") return { good: typeof m.good === "string" ? m.good : null, slow: m.slow && typeof m.slow === "object" ? m.slow : {} }; } catch {}
  return { good: null, slow: {} };
}
function saveMemo(m: Memo) { try { sessionStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch {} }
function memoNow(): { prefer?: string; skip?: string[] } {
  const m = loadMemo(), now = Date.now();
  const skip = Object.entries(m.slow).filter(([, until]) => Number(until) > now).map(([k]) => k);
  return { ...(m.good && !skip.includes(m.good) ? { prefer: m.good } : {}), ...(skip.length ? { skip } : {}) };
}
function memoGood(model: string) { const m = loadMemo(); m.good = model; delete m.slow[model]; saveMemo(m); }
function memoSlow(model: string) { const m = loadMemo(); m.slow[model] = Date.now() + SLOW_MS; if (m.good === model) m.good = null; saveMemo(m); }

// Sends one batch to /api/generate and calls onQ for every question the moment it is written.
// Returns null on success, or a Fail describing what went wrong (rate limit, busy, bad key...).
export async function streamBatch(body: object, signal: AbortSignal, onQ: (q: Q) => void): Promise<Fail | null> {
  // Phones freeze a page that is in the background / locked: the request then hangs forever ("keeps loading").
  // Watchdog: if no data arrives for a long time, or we come back to the page after a long silence, give up this request so the caller can retry.
  const local = new AbortController();
  const onOuter = () => local.abort();
  if (signal.aborted) local.abort(); else signal.addEventListener("abort", onOuter, { once: true });
  let last = Date.now(), dog = false;
  const check = (limit: number) => { if (Date.now() - last > limit) { dog = true; local.abort(); } };
  const iv = setInterval(() => check(55_000), 5_000);
  let hiddenAt = 0;
  const onVis = () => { if (document.visibilityState === "hidden") hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 4_000) { hiddenAt = 0; check(8_000); } }; // came back after a real absence and nothing arrived meanwhile -> the request is probably dead
  document.addEventListener("visibilitychange", onVis);
  try {
    return await run();
  } catch (e) {
    if (dog && !signal.aborted) return { code: "timeout", message: "توقف الاتصال (ربما خرجت من الصفحة أو انطفأت الشاشة). سنعيد المحاولة.", retryAfter: 2 };
    throw e;
  } finally {
    clearInterval(iv); document.removeEventListener("visibilitychange", onVis); signal.removeEventListener("abort", onOuter);
  }

  async function run(): Promise<Fail | null> {
  const res = await authFetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, ...memoNow() }), signal: local.signal });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    // Vercel/proxy gateway errors (502/503/504) come back as plain text, not JSON: treat them as "try again with a smaller batch".
    if (!d.code && [502, 503, 504, 524].includes(res.status)) return { code: "timeout", message: `انتهت مهلة الخادم (${res.status})`, retryAfter: 2 };
    return { code: d.code || "error", message: d.error || `فشل توليد الأسئلة (${res.status})`, retryAfter: d.retryAfter };
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    last = Date.now();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { t: string; q?: Q; code?: string; message?: string; retryAfter?: number; model?: string };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.t === "q" && ev.q) { got++; onQ(ev.q); }
      else if (ev.t === "model" && ev.model) memoGood(ev.model);
      else if (ev.t === "slow" && ev.model) memoSlow(ev.model);
      else if (ev.t === "err") return got ? null : { code: ev.code || "error", message: ev.message || "فشل توليد الأسئلة", retryAfter: ev.retryAfter };
    }
  }
  return null;
  }
}
