import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { covers, type Entitlement } from "@/lib/plans";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// FIREBASE_SERVICE_ACCOUNT = the service-account JSON (pasted as is, or base64 of it).
function loadCreds(): any | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  let txt = raw;
  if (!txt.startsWith("{")) { try { txt = Buffer.from(txt, "base64").toString("utf8"); } catch {} }
  try {
    const j = JSON.parse(txt);
    if (j.private_key) j.private_key = String(j.private_key).replace(/\\n/g, "\n");
    return j;
  } catch { return null; }
}

let app: App | null = null;
function adminApp(): App {
  if (app) return app;
  const ex = getApps()[0];
  if (ex) return (app = ex);
  const c = loadCreds();
  if (!c) throw new ApiError(503, "server_not_configured", "الخادم غير مُهيَّأ بعد: أضف المتغير FIREBASE_SERVICE_ACCOUNT في إعدادات Vercel ثم أعد النشر.");
  app = initializeApp({ credential: cert(c) });
  return app;
}
export const db = () => getFirestore(adminApp());

const adminEmails = () => (process.env.ADMIN_EMAILS || "").split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export type AuthedUser = { uid: string; email: string; name: string; picture: string; isAdmin: boolean };

export async function requireUser(req: Request): Promise<AuthedUser> {
  const m = /^Bearer (.+)$/i.exec(req.headers.get("authorization") || "");
  if (!m) throw new ApiError(401, "unauthenticated", "سجّل الدخول أولًا.");
  const a = adminApp(); // may throw server_not_configured
  let d;
  try { d = await getAuth(a).verifyIdToken(m[1]); } catch { throw new ApiError(401, "bad_token", "انتهت الجلسة. أعد تسجيل الدخول."); }
  const email = String(d.email || "").toLowerCase();
  return { uid: d.uid, email, name: String(d.name || ""), picture: String(d.picture || ""), isAdmin: !!email && d.email_verified !== false && adminEmails().includes(email) };
}

export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const u = await requireUser(req);
  if (!u.isAdmin) throw new ApiError(403, "forbidden", "هذه الصفحة للمدير فقط.");
  return u;
}

// Wraps a route: ApiError -> clean JSON error, anything else -> 500.
export async function handle(fn: () => Promise<Response | object>): Promise<Response> {
  try {
    const r = await fn();
    return r instanceof Response ? r : NextResponse.json(r);
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.status });
    console.error("api error", e);
    return NextResponse.json({ code: "server_error", error: "حدث خطأ في الخادم. حاول مرة أخرى." }, { status: 500 });
  }
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new ApiError(400, "bad_request", "طلب غير صالح."); }
}

// Does this person have the right to use `subject` right now? (admins always do). Cached for a few seconds so a burst of batches costs one read.
const cache = new Map<string, { at: number; ents: Entitlement[] }>();
export async function assertSubjectAccess(u: AuthedUser, subject: string) {
  if (u.isAdmin) return;
  const now = Date.now();
  let hit = cache.get(u.uid);
  if (!hit || now - hit.at > 15_000) {
    const s = await db().collection("users").doc(u.uid).get();
    hit = { at: now, ents: ((s.data()?.entitlements as Entitlement[]) ?? []) };
    cache.set(u.uid, hit);
    if (cache.size > 500) cache.clear();
  }
  if (!covers(hit.ents, subject, now)) throw new ApiError(403, "no_access", "لا يشمل اشتراكك هذه المادة أو انتهى اشتراكك. فعّل كودًا جديدًا من زر «اشتراكي».");
}
export const dropAccessCache = (uid: string) => cache.delete(uid);
