import { ApiError, db, dropAccessCache, handle, readJson, requireUser } from "@/lib/server/admin";
import { grant, isCodeShape, normalizeCode, type CodeDoc, type Entitlement } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FAILS = 8;           // wrong codes in a row...
const LOCK_MS = 15 * 60_000;   // ...lock code entry for this long (stops guessing)

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson<{ code?: string }>(req);
    const id = normalizeCode(b.code ?? "");
    const userRef = db().collection("users").doc(u.uid);

    const res = await db().runTransaction(async (tx) => {
      const now = Date.now();
      const us = await tx.get(userRef);
      const user = us.data() ?? {};
      if (!user.name || !user.phone) return { err: [400, "no_profile", "أكمل بيانات المدرس أولًا."] as const };
      if ((user.redeemLockUntil ?? 0) > now) return { err: [429, "locked", "محاولات خاطئة كثيرة. انتظر بضع دقائق ثم حاول مرة أخرى."] as const };

      const codeRef = db().collection("codes").doc(isCodeShape(id) ? id : "_invalid_");
      const cs = await tx.get(codeRef);
      const code = cs.data() as CodeDoc | undefined;
      if (!isCodeShape(id) || !code || code.status !== "unused") {
        const fails = (user.redeemFails ?? 0) + 1;
        tx.set(userRef, fails >= MAX_FAILS ? { redeemFails: 0, redeemLockUntil: now + LOCK_MS } : { redeemFails: fails }, { merge: true });
        return { err: [400, "bad_code", "الكود غير صحيح أو سبق استخدامه أو تم إلغاؤه."] as const };
      }

      const ents: Entitlement[] = grant(user.entitlements, code.subject, code.days, id, now);
      tx.set(userRef, { entitlements: ents, redeemFails: 0 }, { merge: true });
      tx.update(codeRef, { status: "used", usedBy: u.uid, usedByName: user.name, usedByPhone: user.phone, usedByEmail: u.email, usedAt: now });
      return { ok: true as const, entitlements: ents, now };
    });

    if ("err" in res && res.err) throw new ApiError(res.err[0], res.err[1], res.err[2]);
    dropAccessCache(u.uid);
    return res;
  });
}
