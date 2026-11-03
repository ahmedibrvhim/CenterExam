// Subscription plans + the entitlement rules. Pure code (no Firebase): used by the browser AND the server.
import { SUBJECTS, getSubject, type SubjectId } from "@/lib/subjects";

export type Plan = "single" | "all";
export type EntKey = SubjectId | "all";

// Pricing: one subject = 200 EGP / month. "All subjects" = (number of subjects x 200) with a 50% discount.
export const UNIT_PRICE = 200;
export const ALL_DISCOUNT = 0.5;
export const SUBJECT_COUNT = SUBJECTS.length;
export const LIST_PRICE: Record<Plan, number> = { single: UNIT_PRICE, all: SUBJECT_COUNT * UNIT_PRICE }; // before the discount
export const PRICE: Record<Plan, number> = { single: UNIT_PRICE, all: Math.round(SUBJECT_COUNT * UNIT_PRICE * (1 - ALL_DISCOUNT)) }; // EGP per month, what the customer pays
export const PLAN_DAYS = 30;
export const CURRENCY = "جنيه";
export const DAY_MS = 86_400_000;

// One subscription "right": a subject (or all of them) that works until expiresAt.
export type Entitlement = { subject: EntKey; startedAt: number; expiresAt: number; code: string };

export const isActive = (e: Entitlement, now: number) => e.expiresAt > now;
export const activeOf = (list: Entitlement[] | undefined, now: number) => (list ?? []).filter((e) => isActive(e, now));
export const covers = (list: Entitlement[] | undefined, subject: string, now: number) =>
  activeOf(list, now).some((e) => e.subject === "all" || e.subject === subject);
export const daysLeft = (e: Entitlement, now: number) => Math.max(0, Math.ceil((e.expiresAt - now) / DAY_MS));
export const entLabel = (k: EntKey) => (k === "all" ? "كل المواد" : getSubject(k)?.name ?? k);
export const planOf = (k: EntKey): Plan => (k === "all" ? "all" : "single");

// Adds `days` to the right for `key`: still active -> the days are added after its current end; expired / missing -> starts now.
export function grant(list: Entitlement[] | undefined, key: EntKey, days: number, code: string, now: number): Entitlement[] {
  const out = (list ?? []).map((e) => ({ ...e }));
  const i = out.findIndex((e) => e.subject === key);
  if (i < 0) out.push({ subject: key, startedAt: now, expiresAt: now + days * DAY_MS, code });
  else if (out[i].expiresAt > now) { out[i].expiresAt += days * DAY_MS; out[i].code = code; }
  else out[i] = { subject: key, startedAt: now, expiresAt: now + days * DAY_MS, code };
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
  id: string; plan: Plan; subject: EntKey; price: number; days: number; orderId?: string;
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
  plan: Plan; subject: EntKey; price: number; listPrice: number; days: number;
  status: OrderStatus; createdAt: number;
  codeId?: string; codeAt?: number; activatedAt?: number; cancelledAt?: number;
};
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { pending: "بانتظار الدفع", code_sent: "تم إرسال الكود", activated: "مُفعّل", cancelled: "ملغي" };
export const isOpenOrder = (o: Pick<OrderDoc, "status">) => o.status === "pending" || o.status === "code_sent";

export type UserDoc = {
  uid: string; email: string; displayName: string; photoURL: string; name: string; phone: string;
  createdAt: number; entitlements: Entitlement[];
};
