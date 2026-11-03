import { ApiError, db, dropAccessCache, handle, readJson, requireUser, trialKey } from "@/lib/server/admin";
import { cleanName, cleanPhone, grantTerm, isTrial, TRIAL_MS, type Entitlement } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free trial: ONE time per person, 1 hour, ALL subjects. Instant (no order, no code, no payment).
// "Once" is enforced inside a transaction against two places: the user record (trialUsedAt) and trials/<e-mail>, which survives a deleted / recreated user record.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.isAdmin) throw new ApiError(403, "admin_no_sub", "حساب المدير مفتوح دائمًا ولا يحتاج اشتراكًا.");
    const b = await readJson<{ name?: string; phone?: string }>(req);
    const name = cleanName(b.name ?? "");
    const phone = cleanPhone(b.phone ?? "");
    if (name.length < 2) throw new ApiError(400, "bad_name", "اكتب اسم المدرس أو السنتر (حرفان على الأقل).");
    if (!phone) throw new ApiError(400, "bad_phone", "رقم الهاتف غير صحيح. اكتب الأرقام فقط (مثال: 01012345678).");

    const userRef = db().collection("users").doc(u.uid);
    const trialRef = db().collection("trials").doc(trialKey(u));
    const res = await db().runTransaction(async (tx) => {
      const [us, ts] = await Promise.all([tx.get(userRef), tx.get(trialRef)]);
      const user = us.data() ?? {};
      if (ts.exists || user.trialUsedAt) return { err: [409, "trial_used", "استخدمت التجربة المجانية من قبل. التجربة متاحة مرة واحدة فقط لكل مستخدم."] as const };
      const ents: Entitlement[] = user.entitlements ?? [];
      if (ents.some((e) => !isTrial(e))) return { err: [409, "not_new", "التجربة المجانية متاحة للمستخدمين الجدد فقط."] as const };
      const now = Date.now();
      const list = grantTerm(ents, "all", "trial", "TRIAL", now);
      tx.set(userRef, { uid: u.uid, email: u.email, displayName: u.name, photoURL: u.picture, name, phone, entitlements: list, subscribed: true, trialUsedAt: now, updatedAt: now }, { merge: true });
      tx.set(trialRef, { uid: u.uid, email: u.email, at: now });
      return { ok: true as const, entitlements: list, now, endsAt: now + TRIAL_MS, profile: { name, phone } };
    });
    if ("err" in res && res.err) throw new ApiError(res.err[0], res.err[1], res.err[2]);
    dropAccessCache(u.uid);
    return res;
  });
}
