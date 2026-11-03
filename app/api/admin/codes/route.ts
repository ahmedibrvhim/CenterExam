import { randomInt } from "crypto";
import { ApiError, db, handle, readJson, requireAdmin } from "@/lib/server/admin";
import { CODE_ALPHABET, PLAN_DAYS, PRICE, cleanName, cleanPhone, isCodeShape, normalizeCode, type CodeDoc, type EntKey, type OrderDoc, type Plan } from "@/lib/plans";
import { getSubject } from "@/lib/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const newId = () => "CX" + Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

// Create 1..50 codes for a customer, or ONE code straight from an order (orderId): plan / subject / price / customer are then taken from the order.
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const b = await readJson<{ orderId?: string; plan?: string; subject?: string; quantity?: number; customerName?: string; customerPhone?: string; note?: string }>(req);
    let order: OrderDoc | undefined;
    if (b.orderId) {
      order = (await db().collection("orders").doc(String(b.orderId)).get()).data() as OrderDoc | undefined;
      if (!order) throw new ApiError(404, "not_found", "الطلب غير موجود.");
      if (order.status === "code_sent") throw new ApiError(409, "has_code", "تم إنشاء كود لهذا الطلب بالفعل.");
      if (order.status !== "pending") throw new ApiError(409, "order_closed", "هذا الطلب مُفعّل أو ملغي.");
    }
    const plan: Plan | null = order ? order.plan : b.plan === "single" || b.plan === "all" ? b.plan : null;
    if (!plan) throw new ApiError(400, "bad_plan", "اختر نوع الاشتراك.");
    let subject: EntKey = "all";
    if (order) subject = order.subject;
    else if (plan === "single") {
      const s = getSubject(b.subject);
      if (!s) throw new ApiError(400, "bad_subject", "اختر المادة.");
      subject = s.id;
    }
    const qty = order ? 1 : Math.min(50, Math.max(1, Math.floor(Number(b.quantity) || 1)));
    const phoneRaw = order ? order.phone : String(b.customerPhone ?? "").trim();
    const phone = phoneRaw ? cleanPhone(phoneRaw) : "";
    if (phone === null) throw new ApiError(400, "bad_phone", "رقم هاتف العميل غير صحيح.");

    for (let attempt = 0; attempt < 3; attempt++) {
      const ids = new Set<string>();
      while (ids.size < qty) ids.add(newId());
      const now = Date.now();
      const docs: CodeDoc[] = [...ids].map((id) => ({
        id, plan, subject, price: order ? order.price : PRICE[plan], days: order ? order.days : PLAN_DAYS,
        customerName: order ? order.name : cleanName(b.customerName ?? ""), customerPhone: phone, note: String(b.note ?? "").trim().slice(0, 200),
        status: "unused", createdAt: now, createdBy: admin.email,
        ...(order ? { orderId: order.id } : {}),
      }));
      try {
        const batch = db().batch();
        for (const d of docs) batch.create(db().collection("codes").doc(d.id), d);
        if (order) batch.update(db().collection("orders").doc(order.id), { status: "code_sent", codeId: docs[0].id, codeAt: now });
        await batch.commit();
        return { ok: true, codes: docs };
      } catch (e: any) {
        if (e?.code !== 6 && !/already exists/i.test(String(e?.message))) throw e; // 6 = ALREADY_EXISTS -> extremely unlikely, draw new codes
      }
    }
    throw new ApiError(500, "server_error", "تعذّر إنشاء الأكواد. حاول مرة أخرى.");
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
