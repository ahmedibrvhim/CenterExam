import { randomInt } from "crypto";
import { ApiError, db, handle, readJson, requireUser } from "@/lib/server/admin";
import { ACTIVE_MSG, CODE_ALPHABET, TERM_DAYS, cleanName, cleanPhone, isOpenOrder, isPaidTerm, listPriceOf, paidCover, priceOf, type EntKey, type OrderDoc, type PaidTerm, type Plan } from "@/lib/plans";
import { getSubject } from "@/lib/subjects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const newRef = () => Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

// The teacher places an order (name / phone / plan / subject). The price is ALWAYS computed here, never taken from the browser.
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    if (u.isAdmin) throw new ApiError(403, "admin_no_sub", "حساب المدير مفتوح دائمًا ولا يحتاج اشتراكًا.");
    const b = await readJson<{ name?: string; phone?: string; plan?: string; term?: string; subject?: string }>(req);
    const name = cleanName(b.name ?? "");
    const phone = cleanPhone(b.phone ?? "");
    if (name.length < 2) throw new ApiError(400, "bad_name", "اكتب اسم المدرس أو السنتر (حرفان على الأقل).");
    if (!phone) throw new ApiError(400, "bad_phone", "رقم الهاتف غير صحيح. اكتب الأرقام فقط (مثال: 01012345678).");
    const plan: Plan | null = b.plan === "single" || b.plan === "all" ? b.plan : null;
    if (!plan) throw new ApiError(400, "bad_plan", "اختر نوع الاشتراك.");
    const term: PaidTerm | null = b.term === undefined ? "month" : isPaidTerm(b.term) ? b.term : null; // no term = monthly (older browsers)
    if (!term) throw new ApiError(400, "bad_term", "اختر مدة الاشتراك (شهري أو سنوي أو دائم). التجربة المجانية لا تحتاج طلبًا.");
    let subject: EntKey = "all";
    if (plan === "single") {
      const s = getSubject(b.subject);
      if (!s) throw new ApiError(400, "bad_subject", "اختر المادة.");
      subject = s.id;
    }

    // still subscribed (paid, not ended) to this subject / to all subjects -> no renewal and no new order until it ends
    const me = await db().collection("users").doc(u.uid).get();
    if (paidCover(me.data()?.entitlements, subject, Date.now())) throw new ApiError(409, "already_active", ACTIVE_MSG);

    // one open order at a time: an unpaid one is replaced, one whose code was already issued must be finished first
    const mine = await db().collection("orders").where("uid", "==", u.uid).get();
    const open = mine.docs.map((d) => d.data() as OrderDoc).filter(isOpenOrder);
    if (open.some((o) => o.status === "code_sent")) throw new ApiError(409, "order_open", "لديك طلب تم إصدار كوده بالفعل. أدخل الكود لتفعيله أولًا.");

    const now = Date.now();
    const ref = db().collection("orders").doc();
    const order: OrderDoc = {
      id: ref.id, ref: newRef(), uid: u.uid, email: u.email, name, phone,
      plan, term, subject, price: priceOf(term, plan), listPrice: listPriceOf(term, plan), days: TERM_DAYS[term], // forever: days = 0
      status: "pending", createdAt: now,
    };
    const batch = db().batch();
    for (const o of open) batch.update(db().collection("orders").doc(o.id), { status: "cancelled", cancelledAt: now }); // replaced by the new one
    batch.set(ref, order);
    batch.set(db().collection("users").doc(u.uid), { uid: u.uid, email: u.email, displayName: u.name, photoURL: u.picture, name, phone, updatedAt: now }, { merge: true });
    await batch.commit();
    return { ok: true, order, profile: { name, phone } };
  });
}

// The teacher cancels his own unpaid order (to change the plan / subject).
export async function PATCH(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson<{ id?: string; action?: string }>(req);
    if (b.action !== "cancel") throw new ApiError(400, "bad_action", "إجراء غير معروف.");
    const ref = db().collection("orders").doc(String(b.id ?? "_"));
    const s = await ref.get();
    const o = s.data() as OrderDoc | undefined;
    if (!o || o.uid !== u.uid) throw new ApiError(404, "not_found", "الطلب غير موجود.");
    if (o.status !== "pending") throw new ApiError(409, "order_locked", "لا يمكن إلغاء هذا الطلب بعد إصدار الكود. تواصل معنا.");
    await ref.update({ status: "cancelled", cancelledAt: Date.now() });
    return { ok: true };
  });
}
