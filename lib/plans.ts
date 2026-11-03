// Subscription plans + the entitlement rules. Pure code (no Firebase): used by the browser AND the server.
import { SUBJECTS, getSubject, type SubjectId } from "@/lib/subjects";

export type Plan = "single" | "all";
export type EntKey = SubjectId | "all";

// How long a subscription lasts. month / year / forever are paid (an order + a code); trial is free, instant, once per user.
export type Term = "month" | "year" | "forever" | "trial";
export type PaidTerm = Exclude<Term, "trial">;
export const TERMS: Term[] = ["month", "year", "forever", "trial"];
export const PAID_TERMS: PaidTerm[] = ["month", "year", "forever"];
export const isTerm = (t: unknown): t is Term => TERMS.includes(t as Term);
export const isPaidTerm = (t: unknown): t is PaidTerm => PAID_TERMS.includes(t as PaidTerm);
export const termOf = (x: { term?: Term } | undefined | null): Term => x?.term ?? "month"; // old orders / codes / rights have no term = monthly
export const TERM_LABEL: Record<Term, string> = { month: "شهري", year: "سنوي", forever: "دائم", trial: "تجربة مجانية" };
export const TERM_DAYS: Record<Term, number> = { month: 30, year: 365, forever: 0, trial: 0 };
export const TERM_LENGTH: Record<Term, string> = { month: "30 يومًا", year: "سنة كاملة (365 يومًا)", forever: "دائم — بدون تاريخ انتهاء", trial: "ساعة واحدة" };
export const TERM_UNIT: Record<Term, string> = { month: "/ شهر", year: "/ سنة", forever: "مرة واحدة", trial: "مجانًا" };

// Pricing (EGP). One subject / all subjects, per term. "All subjects" is cheaper than buying every subject one by one.
export const UNIT_PRICE = 200;                 // one subject, monthly
export const SUBJECT_COUNT = SUBJECTS.length;
export const PRICES: Record<PaidTerm, Record<Plan, number>> = {
  month: { single: UNIT_PRICE, all: Math.round(SUBJECT_COUNT * UNIT_PRICE * 0.5) },
  year: { single: 1000, all: 2500 },
  forever: { single: 2000, all: 4000 },
};
export const priceOf = (term: Term, plan: Plan) => (isPaidTerm(term) ? PRICES[term][plan] : 0);
// what the same thing would cost bought subject by subject (shown crossed out next to "all subjects")
export const listPriceOf = (term: Term, plan: Plan) => (isPaidTerm(term) ? (plan === "all" ? SUBJECT_COUNT * PRICES[term].single : PRICES[term].single) : 0);
export const discountPct = (term: Term) => (isPaidTerm(term) ? Math.round((1 - priceOf(term, "all") / listPriceOf(term, "all")) * 100) : 0);

export const TRIAL_MS = 3_600_000;             // free trial: one hour, all subjects, once per person
export const FOREVER_AT = 253_402_300_799_000; // "no end": 31 Dec 9999. expiresAt of a forever right, so `expiresAt > now` stays true
export const CURRENCY = "جنيه";
export const DAY_MS = 86_400_000;

// One subscription "right": a subject (or all of them) that works until expiresAt (forever: expiresAt = FOREVER_AT).
export type Entitlement = { subject: EntKey; startedAt: number; expiresAt: number; code: string; term?: Term };

export const isActive = (e: Entitlement, now: number) => e.expiresAt > now;
export const activeOf = (list: Entitlement[] | undefined, now: number) => (list ?? []).filter((e) => isActive(e, now));
export const covers = (list: Entitlement[] | undefined, subject: string, now: number) =>
  activeOf(list, now).some((e) => e.subject === "all" || e.subject === subject);
export const isForever = (e: Entitlement) => e.term === "forever" || e.expiresAt >= FOREVER_AT;
export const isTrial = (e: Entitlement) => e.term === "trial";
export const daysLeft = (e: Entitlement, now: number) => (isForever(e) ? Infinity : Math.max(0, Math.ceil((e.expiresAt - now) / DAY_MS)));
export const entLabel = (k: EntKey) => (k === "all" ? "كل المواد" : getSubject(k)?.name ?? k);
export const planOf = (k: EntKey): Plan => (k === "all" ? "all" : "single");

// Arabic counts: يوم واحد / يومان / 3-10 أيام / 11+ يومًا
export const arDays = (n: number) => (n <= 0 ? "ينتهي اليوم" : n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n <= 10 ? `${n} أيام` : `${n} يومًا`);
export const arMinutes = (n: number) => (n <= 1 ? "أقل من دقيقة" : n === 2 ? "دقيقتان" : n <= 10 ? `${n} دقائق` : `${n} دقيقة`);
// "دائم" / "42 دقيقة" / "12 يومًا": what is left of a right, for pills and the header
export function leftText(e: Entitlement, now: number): string {
  if (isForever(e)) return "دائم";
  if (isTrial(e)) return arMinutes(Math.max(0, Math.ceil((e.expiresAt - now) / 60_000)));
  return arDays(daysLeft(e, now));
}
// close to its end? (trial: last 10 minutes; timed: last 3 days; forever: never)
export const isLow = (e: Entitlement, now: number) => !isForever(e) && (isTrial(e) ? e.expiresAt - now <= 600_000 : daysLeft(e, now) <= 3);

// Gives the right for `key` according to `term`.
//   forever -> never ends (replaces anything on that key)
//   month / year (or `days` for the admin's manual "+N days") -> still active: the time is added after its end; expired / missing / trial: starts now
//   a forever right is never shortened or replaced by a timed one
export function grantTerm(list: Entitlement[] | undefined, key: EntKey, term: Term, code: string, now: number, days?: number): Entitlement[] {
  const out = (list ?? []).map((e) => ({ ...e }));
  const i = out.findIndex((e) => e.subject === key);
  const cur = i < 0 ? null : out[i];
  const put = (e: Entitlement) => { if (i < 0) out.push(e); else out[i] = e; };
  if (term === "forever") { put({ subject: key, startedAt: cur && isActive(cur, now) && !isTrial(cur) ? cur.startedAt : now, expiresAt: FOREVER_AT, code, term }); return out; }
  if (cur && isForever(cur)) return out;
  const ms = term === "trial" ? TRIAL_MS : (days ?? TERM_DAYS[term]) * DAY_MS;
  if (cur && isActive(cur, now) && !isTrial(cur) && term !== "trial") put({ ...cur, expiresAt: cur.expiresAt + ms, code, term });
  else put({ subject: key, startedAt: now, expiresAt: now + ms, code, term });
  return out;
}

// ---- codes: CX-XXXX-XXXX-XXXX (no 0/O/1/I/L so they are easy to read out and type) ----
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normalizeCode = (raw: string) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isCodeShape = (id: string) => /^CX[A-Z0-9]{12}$/.test(id);
export const formatCode = (id: string) => (id.length === 14 ? `${id.slice(0, 2)}-${id.slice(2, 6)}-${id.slice(6, 10)}-${id.slice(10)}` : id);

// Arabic-Indic digits -> 0-9, then keep a plain phone number
const AR = "٠١٢٣٤٥٦٧٨٩", FA = "۰۱۲۳۴۵۶۷۸۹";
export function cleanPhone(raw: string): string | null {
  const s = String(raw ?? "").replace(/[٠-٩۰-۹]/g, (d) => String(AR.includes(d) ? AR.indexOf(d) : FA.indexOf(d))).replace(/[\s\-().]/g, "");
  return /^\+?\d{8,15}$/.test(s) ? s : null;
}
export const cleanName = (raw: string) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

export type CodeDoc = {
  id: string; plan: Plan; term?: Term; subject: EntKey; price: number; days: number; orderId?: string;
  customerName: string; customerPhone: string; note: string;
  status: "unused" | "used" | "revoked";
  createdAt: number; createdBy: string;
  usedBy?: string; usedByName?: string; usedByPhone?: string; usedByEmail?: string; usedAt?: number;
};
// An order = what the teacher asked for before paying. The admin sees it, checks the payment and creates the code from it.
//  pending   -> placed, waiting for payment / code
//  code_sent -> admin created the code for it
//  activated -> the teacher entered the code
//  cancelled -> cancelled by the teacher or the admin
export type OrderStatus = "pending" | "code_sent" | "activated" | "cancelled";
export type OrderDoc = {
  id: string; ref: string; uid: string; email: string; name: string; phone: string;
  plan: Plan; term?: Term; subject: EntKey; price: number; listPrice: number; days: number;
  status: OrderStatus; createdAt: number;
  codeId?: string; codeAt?: number; activatedAt?: number; cancelledAt?: number;
};
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { pending: "بانتظار الدفع", code_sent: "تم إرسال الكود", activated: "مُفعّل", cancelled: "ملغي" };
export const isOpenOrder = (o: Pick<OrderDoc, "status">) => o.status === "pending" || o.status === "code_sent";

export type UserDoc = {
  uid: string; email: string; displayName: string; photoURL: string; name: string; phone: string;
  createdAt: number; entitlements: Entitlement[]; trialUsedAt?: number;
};
