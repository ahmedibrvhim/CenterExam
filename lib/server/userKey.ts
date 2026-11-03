import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ApiError, db, trialKey, type AuthedUser } from "@/lib/server/admin";
import { activeOf, isTrial, type Entitlement } from "@/lib/plans";

// Each teacher's own Gemini key lives in Firestore, collection "geminiKeys", ENCRYPTED (AES-256-GCM) with KEY_ENCRYPTION_SECRET.
// It is keyed by e-mail (same rule as the free trial), so deleting/recreating the Auth user does not lose it.
// The key is never sent back to the browser: only the last 4 characters are shown.
const COL = "geminiKeys";

function secret(): Buffer {
  const s = process.env.KEY_ENCRYPTION_SECRET;
  if (!s || s.length < 16) throw new ApiError(503, "server_not_configured", "الخادم غير مُهيَّأ: أضف المتغير KEY_ENCRYPTION_SECRET (نص عشوائي طويل) في إعدادات Vercel ثم أعد النشر.");
  return createHash("sha256").update(s).digest();
}
function encrypt(plain: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secret(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}
function decrypt(enc: string): string | null {
  try {
    const [v, iv, tag, ct] = enc.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}

// NO key-format rule (Google has changed the format before and will again). Only sanity: one token, no spaces, sensible length.
export const looksLikeGeminiKey = (k: string) => k.length >= 8 && k.length <= 600 && !/\s/.test(k);

// Only a FOUND key is cached (briefly). "No key" is never cached: on Vercel several server instances run side by side, and an instance that
// remembered "no key" would keep telling the teacher to add a key for a while after another instance had saved it.
const cache = new Map<string, { at: number; key: string | null; last4: string }>();
async function load(u: AuthedUser) {
  const id = trialKey(u), hit = cache.get(id);
  if (hit && hit.key && Date.now() - hit.at < 30_000) return hit;
  const s = await db().collection(COL).doc(id).get();
  const enc = s.exists ? String(s.data()?.enc ?? "") : "";
  const key = enc ? decrypt(enc) : null;
  const v = { at: Date.now(), key, last4: key ? key.slice(-4) : "" };
  if (key) { cache.set(id, v); if (cache.size > 500) cache.clear(); } else cache.delete(id);
  return v;
}

// Is this person on the FREE TRIAL only? (has running rights and every one of them is a trial; a paid right means they must use their own key)
const trialCache = new Map<string, { at: number; on: boolean }>();
async function onTrialOnly(u: AuthedUser): Promise<boolean> {
  const hit = trialCache.get(u.uid);
  if (hit && Date.now() - hit.at < 15_000) return hit.on;
  const s = await db().collection("users").doc(u.uid).get();
  const act = activeOf((s.data()?.entitlements as Entitlement[]) ?? [], Date.now());
  const on = act.length > 0 && act.every(isTrial);
  trialCache.set(u.uid, { at: Date.now(), on });
  if (trialCache.size > 500) trialCache.clear();
  return on;
}

// May this person use the shared GEMINI_API_KEY from Vercel? Admins, people on the free trial, and everyone if ALLOW_SHARED_GEMINI_KEY=1.
async function mayUseShared(u: AuthedUser): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  return u.isAdmin || process.env.ALLOW_SHARED_GEMINI_KEY === "1" || (await onTrialOnly(u));
}

// The key this person must use. Their own key first; otherwise the site's key (admins + free trial); paid subscribers must add their own.
export async function getUserKey(u: AuthedUser): Promise<{ key: string; own: boolean } | null> {
  const own = await load(u);
  if (own.key) return { key: own.key, own: true };
  if (await mayUseShared(u)) return { key: process.env.GEMINI_API_KEY!, own: false };
  return null;
}
export async function keyInfo(u: AuthedUser) {
  const own = await load(u);
  return { hasOwn: !!own.key, last4: own.last4, usingShared: !own.key && (await mayUseShared(u)), isAdmin: u.isAdmin };
}
export async function saveUserKey(u: AuthedUser, key: string) {
  const id = trialKey(u);
  await db().collection(COL).doc(id).set({ enc: encrypt(key), uid: u.uid, email: u.email, updatedAt: Date.now() });
  cache.delete(id);
}
export async function deleteUserKey(u: AuthedUser) {
  const id = trialKey(u);
  await db().collection(COL).doc(id).delete();
  cache.delete(id);
}

// One cheap call to Google (listing models costs no generation quota).
// A key is rejected ONLY when Google explicitly says it is invalid; any other answer (network problem, other 4xx/5xx) still saves it.
export async function checkGeminiKey(key: string): Promise<"ok" | "bad" | "unknown"> {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8000) });
    if (r.ok) return "ok";
    const j: any = await r.json().catch(() => ({}));
    const txt = JSON.stringify(j?.error ?? {});
    if (/API_KEY_INVALID|API key not valid|API key expired/i.test(txt)) return "bad";
    return "unknown";
  } catch { return "unknown"; }
}
