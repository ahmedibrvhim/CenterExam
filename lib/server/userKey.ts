import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ApiError, db, trialKey, type AuthedUser } from "@/lib/server/admin";

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

export const looksLikeGeminiKey = (k: string) => /^AIza[0-9A-Za-z_-]{30,60}$/.test(k);

const cache = new Map<string, { at: number; key: string | null; last4: string }>();
async function load(u: AuthedUser) {
  const id = trialKey(u), hit = cache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const s = await db().collection(COL).doc(id).get();
  const enc = s.exists ? String(s.data()?.enc ?? "") : "";
  const key = enc ? decrypt(enc) : null;
  const v = { at: Date.now(), key, last4: key ? key.slice(-4) : "" };
  cache.set(id, v);
  if (cache.size > 500) cache.clear();
  return v;
}

// The key this person must use. Their own key first. The shared GEMINI_API_KEY from Vercel is used ONLY for admins,
// or for everyone if you set ALLOW_SHARED_GEMINI_KEY=1 (useful as a temporary fallback while teachers add their keys).
export async function getUserKey(u: AuthedUser): Promise<{ key: string; own: boolean } | null> {
  const own = await load(u);
  if (own.key) return { key: own.key, own: true };
  const shared = process.env.GEMINI_API_KEY;
  if (shared && (u.isAdmin || process.env.ALLOW_SHARED_GEMINI_KEY === "1")) return { key: shared, own: false };
  return null;
}
export async function keyInfo(u: AuthedUser) {
  const own = await load(u);
  return { hasOwn: !!own.key, last4: own.last4 };
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

// One cheap call to Google (listing models costs no generation quota) to know whether the key is real.
export async function checkGeminiKey(key: string): Promise<"ok" | "bad" | "unknown"> {
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(8000) });
    if (r.ok) return "ok";
    if (r.status === 400 || r.status === 401 || r.status === 403) return "bad";
    return "unknown";
  } catch { return "unknown"; }
}
