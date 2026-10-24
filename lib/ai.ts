import type { Q } from "@/exam";

export type Fail = { code: string; message: string; retryAfter?: number };

// Sends one batch to /api/generate and calls onQ for every question the moment it is written.
// Returns null on success, or a Fail describing what went wrong (rate limit, busy, bad key...).
export async function streamBatch(body: object, signal: AbortSignal, onQ: (q: Q) => void): Promise<Fail | null> {
  const res = await fetch("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    return { code: d.code || "error", message: d.error || "فشل توليد الأسئلة", retryAfter: d.retryAfter };
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { t: string; q?: Q; code?: string; message?: string };
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.t === "q" && ev.q) { got++; onQ(ev.q); }
      else if (ev.t === "err") return got ? null : { code: ev.code || "error", message: ev.message || "فشل توليد الأسئلة" };
    }
  }
  return null;
}
