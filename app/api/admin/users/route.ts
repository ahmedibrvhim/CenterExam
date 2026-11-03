import { ApiError, db, dropAccessCache, handle, readJson, requireAdmin } from "@/lib/server/admin";
import { grant, type EntKey, type Entitlement } from "@/lib/plans";
import { getSubject } from "@/lib/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual control of one subscriber: add / extend days (also negative = shorten), or remove a subject.
export async function POST(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const b = await readJson<{ uid?: string; action?: string; subject?: string; days?: number }>(req);
    const uid = String(b.uid ?? "");
    if (!uid) throw new ApiError(400, "bad_request", "مشترك غير محدد.");
    const key: EntKey | null = b.subject === "all" ? "all" : getSubject(b.subject)?.id ?? null;
    if (!key) throw new ApiError(400, "bad_subject", "اختر المادة.");
    const ref = db().collection("users").doc(uid);

    const ents = await db().runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new ApiError(404, "not_found", "المشترك غير موجود.");
      let list: Entitlement[] = s.data()?.entitlements ?? [];
      const now = Date.now();
      if (b.action === "grant") {
        const days = Math.min(366, Math.max(1, Math.floor(Number(b.days) || 30)));
        list = grant(list, key, days, "ADMIN", now);
      } else if (b.action === "remove") {
        list = list.map((e) => (e.subject === key ? { ...e, expiresAt: Math.min(e.expiresAt, now) } : e)); // end it now but keep the row (history)
      } else throw new ApiError(400, "bad_action", "إجراء غير معروف.");
      tx.update(ref, { entitlements: list, subscribed: true });
      return list;
    });
    dropAccessCache(uid);
    return { ok: true, entitlements: ents };
  });
}
