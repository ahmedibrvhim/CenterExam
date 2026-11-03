import { randomInt } from "crypto";
import { ApiError, db, handle, readJson, requireAdmin } from "@/lib/server/admin";
import { CODE_ALPHABET, PLAN_DAYS, PRICE, cleanName, cleanPhone, isCodeShape, normalizeCode, type CodeDoc, type EntKey, type Plan } from "@/lib/plans";
import { getSubject } from "@/lib/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const newId = () => "CX" + Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

// Create 1..50 codes for a customer.
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(req);
    const b = await readJson<{ plan?: string; subject?: string; quantity?: number; customerName?: string; customerPhone?: string; note?: string }>(req);
    const plan: Plan | null = b.plan === "single" || b.plan === "all" ? b.plan : null;
    if (!plan) throw new ApiError(400, "bad_plan", "اختر نوع الاشتراك.");
    let subject: EntKey = "all";
    if (plan === "single") {
      const s = getSubject(b.subject);
      if (!s) throw new ApiError(400, "bad_subject", "اختر المادة.");
      subject = s.id;
    }
    const qty = Math.min(50, Math.max(1, Math.floor(Number(b.quantity) || 1)));
    const phoneRaw = String(b.customerPhone ?? "").trim();
    const phone = phoneRaw ? cleanPhone(phoneRaw) : "";
    if (phone === null) throw new ApiError(400, "bad_phone", "رقم هاتف العميل غير صحيح.");

    for (let attempt = 0; attempt < 3; attempt++) {
      const ids = new Set<string>();
      while (ids.size < qty) ids.add(newId());
      const now = Date.now();
      const docs: CodeDoc[] = [...ids].map((id) => ({
        id, plan, subject, price: PRICE[plan], days: PLAN_DAYS,
        customerName: cleanName(b.customerName ?? ""), customerPhone: phone, note: String(b.note ?? "").trim().slice(0, 200),
        status: "unused", createdAt: now, createdBy: admin.email,
      }));
      try {
        const batch = db().batch();
        for (const d of docs) batch.create(db().collection("codes").doc(d.id), d);
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
