import { ApiError, db, handle, readJson, requireAdmin } from "@/lib/server/admin";
import type { CodeDoc, OrderDoc } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin cancels an order. If a code was already created for it and nobody used it yet, the code is revoked too.
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const b = await readJson<{ id?: string; action?: string }>(req);
    if (b.action !== "cancel") throw new ApiError(400, "bad_action", "إجراء غير معروف.");
    const ref = db().collection("orders").doc(String(b.id ?? "_"));
    const s = await ref.get();
    const o = s.data() as OrderDoc | undefined;
    if (!o) throw new ApiError(404, "not_found", "الطلب غير موجود.");
    if (o.status === "activated") throw new ApiError(409, "activated", "هذا الطلب مُفعّل بالفعل. لإنهاء الاشتراك استخدم تبويب المشتركين.");
    const batch = db().batch();
    batch.update(ref, { status: "cancelled", cancelledAt: Date.now() });
    if (o.codeId) {
      const cref = db().collection("codes").doc(o.codeId);
      const c = (await cref.get()).data() as CodeDoc | undefined;
      if (c && c.status === "unused") batch.update(cref, { status: "revoked" });
    }
    await batch.commit();
    return { ok: true };
  });
}
