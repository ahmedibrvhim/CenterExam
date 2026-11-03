import { ApiError, db, handle, readJson, requireUser } from "@/lib/server/admin";
import { cleanName, cleanPhone } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson<{ name?: string; phone?: string }>(req);
    const name = cleanName(b.name ?? "");
    const phone = cleanPhone(b.phone ?? "");
    if (name.length < 2) throw new ApiError(400, "bad_name", "اكتب اسم المدرس (حرفان على الأقل).");
    if (!phone) throw new ApiError(400, "bad_phone", "رقم الهاتف غير صحيح. اكتب الأرقام فقط (مثال: 01012345678).");
    await db().collection("users").doc(u.uid).set(
      { uid: u.uid, email: u.email, displayName: u.name, photoURL: u.picture, name, phone, updatedAt: Date.now() },
      { merge: true },
    );
    return { ok: true, profile: { name, phone } };
  });
}
