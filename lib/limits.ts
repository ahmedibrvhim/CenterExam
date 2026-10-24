// Tracks the free AI limits. Google doesn't tell us how many requests are left, so:
//  - when Google answers "429" we learn exactly which limit was hit (per minute or per day) and for how long;
//  - we also count the requests sent from this browser today (an approximation, shown as information only).
export type Limit = { kind: "minute" | "busy" | "day"; until: number } | null;

const LIMIT_KEY = "centerapp-exams-limit", USAGE_KEY = "centerapp-exams-usage";

// Google's daily free quota resets at midnight Pacific time.
function pacificParts() {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date())) o[p.type] = p.value;
  return { day: `${o.year}-${o.month}-${o.day}`, h: Number(o.hour) % 24, m: Number(o.minute), s: Number(o.second) };
}
export function msUntilPacificMidnight(): number {
  const { h, m, s } = pacificParts();
  return ((24 - h) * 3600 - m * 60 - s) * 1000;
}

export function getLimit(): Limit {
  try {
    const v = JSON.parse(localStorage.getItem(LIMIT_KEY) || "null");
    if (v && v.kind === "day" && v.until > Date.now()) return v;
  } catch {}
  return null;
}
export function saveLimit(l: Limit) {
  try { if (l && l.kind === "day") localStorage.setItem(LIMIT_KEY, JSON.stringify(l)); else localStorage.removeItem(LIMIT_KEY); } catch {}
}

export function getUsage(): number {
  try {
    const v = JSON.parse(localStorage.getItem(USAGE_KEY) || "null");
    if (v && v.day === pacificParts().day) return v.count as number;
  } catch {}
  return 0;
}
export function recordRequest(): number {
  const n = getUsage() + 1;
  try { localStorage.setItem(USAGE_KEY, JSON.stringify({ day: pacificParts().day, count: n })); } catch {}
  return n;
}

export function fmtDuration(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (h) return `${h} س ${m} د`;
  if (m) return `${m} د ${s} ث`;
  return `${s} ث`;
}
export const fmtClock = (ms: number) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
