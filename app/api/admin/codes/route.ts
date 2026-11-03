import { randomInt } from "crypto";
import { ApiError, db, handle, readJson, requireAdmin } from "@/lib/server/admin";
import { CODE_ALPHABET, isCodeShape, normalizeCode, type CodeDoc, type OrderDoc } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const newId = () => "CX" + Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

// A code is ONLY created from an order (orderId): plan / subject / price / customer are taken from the order. No manual codes.
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const b = await readJson<{ orderId?: string }>(req);
    if (!b.orderId) throw new ApiError(400, "order_required", "الكود يُنشأ من الطلب فقط. افتح تبويب الطلبات واضغط «إنشاء كود».");
    const order = (await db().collection("orders").doc(String(b.orderId)).get()).data() as OrderDoc | undefined;
    if (!order) throw new ApiError(404, "not_found", "الطلب غير موجود.");
    if (order.status === "code_sent") throw new ApiError(409, "has_code", "تم إنشاء كود لهذا الطلب بالفعل.");
    if (order.status !== "pending") throw new ApiError(409, "order_closed", "هذا الطلب مُفعّل أو ملغي.");

    for (let attempt = 0; attempt < 3; attempt++) {
      const now = Date.now();
      const doc: CodeDoc = {
        id: newId(), plan: order.plan, subject: order.subject, price: order.price, days: order.days,
        customerName: order.name, customerPhone: order.phone, note: "",
        status: "unused", createdAt: now, createdBy: admin.email, orderId: order.id,
      };
      try {
        const batch = db().batch();
        batch.create(db().collection("codes").doc(doc.id), doc);
        batch.update(db().collection("orders").doc(order.id), { status: "code_sent", codeId: doc.id, codeAt: now });
        await batch.commit();
        return { ok: true, codes: [doc] };
      } catch (e: any) {
        if (e?.code !== 6 && !/already exists/i.test(String(e?.message))) throw e; // ALREADY_EXISTS -> draw a new code
      }
    }
    throw new ApiError(500, "server_error", "تعذّر إنشاء الكود. حاول مرة أخرى.");
  });
}

// revoke / restore / delete one code
export async function PATCH(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const b = await readJson<{ code?: string; action?: string }>(req);
    const id = normalizeCode(b.code ?? "");
    if (!isCodeShape(id)) throw new ApiError(400, "bad_code", "كود غير صالح.");
    const ref = db().collection("codes").doc(id);
    const s = await ref.get();
    const c = s.data() as CodeDoc | undefined;
    if (!c) throw new ApiError(404, "not_found", "الكود غير موجود.");
    if (c.status === "used") throw new ApiError(409, "used", "هذا الكود مُستخدم بالفعل. لإنهاء الاشتراك استخدم تبويب المشتركين.");
    if (b.action === "revoke") await ref.update({ status: "revoked" });
    else if (b.action === "restore") await ref.update({ status: "unused" });
    else if (b.action === "delete") await ref.delete();
    else throw new ApiError(400, "bad_action", "إجراء غير معروف.");
    return { ok: true };
  });
}
