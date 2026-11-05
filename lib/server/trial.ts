import { ApiError, db, dropAccessCache, type AuthedUser } from "@/lib/server/admin";
import { activeOf, isTrial, type Entitlement } from "@/lib/plans";

// FREE TRIAL = ONE PDF. The trial ends when the teacher downloads the first PDF (the app calls /api/trial/finish), whatever the subject.
// Because the PDF is built in the browser, the server also caps how many AI batches a trial user may ask for, so nobody can drain the site's Gemini key.
export const TRIAL_MAX_BATCHES = Number(process.env.TRIAL_MAX_BATCHES) || 40;

// Is this person on the free trial ONLY? (has running rights and every one is a trial; a paid right means they are a subscriber)
const cache = new Map<string, { at: number; on: boolean }>();
export const dropTrialCache = (uid: string) => cache.delete(uid);
export async function isTrialOnly(u: AuthedUser): Promise<boolean> {
  if (u.isAdmin) return false;
  // Only "yes, on trial" is cached. A cached "no" is what made a brand-new trial user see the "add your key" banner until the next refresh:
  // the trial starts on one server instance, and another instance still remembered the answer from before the trial existed.
  const hit = cache.get(u.uid);
  if (hit && hit.on && Date.now() - hit.at < 15_000) return true;
  const s = await db().collection("users").doc(u.uid).get();
  const act = activeOf((s.data()?.entitlements as Entitlement[]) ?? [], Date.now());
  const on = act.length > 0 && act.every(isTrial);
  if (on) { cache.set(u.uid, { at: Date.now(), on }); if (cache.size > 500) cache.clear(); } else cache.delete(u.uid);
  return on;
}

// Called before every AI batch: a trial user may only use TRIAL_MAX_BATCHES of them.
export async function chargeTrialBatch(u: AuthedUser): Promise<void> {
  if (!(await isTrialOnly(u))) return;
  const ref = db().collection("users").doc(u.uid);
  const ok = await db().runTransaction(async (tx) => {
    const n = Number((await tx.get(ref)).data()?.trialBatches ?? 0);
    if (n >= TRIAL_MAX_BATCHES) return false;
    tx.set(ref, { trialBatches: n + 1 }, { merge: true });
    return true;
  });
  if (!ok) throw new ApiError(403, "trial_limit", "انتهى الحد المسموح به في التجربة المجانية. اشترك في مادة لمتابعة توليد الأسئلة.");
}

// The first PDF was downloaded: the trial ends now (the right is expired, not deleted, so the app shows "your trial ended" and the subjects lock).
export async function endTrial(u: AuthedUser): Promise<boolean> {
  if (u.isAdmin) return false;
  const ref = db().collection("users").doc(u.uid);
  const ended = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const ents: Entitlement[] = s.data()?.entitlements ?? [];
    const now = Date.now();
    const act = activeOf(ents, now);
    if (!act.length || !act.every(isTrial)) return false; // paid subscribers are never touched
    tx.update(ref, { entitlements: ents.map((e) => (isTrial(e) && e.expiresAt > now ? { ...e, expiresAt: now } : e)), trialPdfAt: now, updatedAt: now });
    return true;
  });
  dropAccessCache(u.uid); dropTrialCache(u.uid);
  return ended;
}
