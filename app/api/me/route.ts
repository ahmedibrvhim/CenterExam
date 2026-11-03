import { db, ensureUserDoc, handle, requireUser } from "@/lib/server/admin";
import { isOpenOrder, type OrderDoc } from "@/lib/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who am I: profile (teacher name + phone), my subscriptions, my open order (if any), and whether I am the admin.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const d = await ensureUserDoc(u); // one record per e-mail, even if the Auth account was deleted and recreated
    const os = await db().collection("orders").where("uid", "==", u.uid).get();
    const order = os.docs.map((x) => x.data() as OrderDoc).filter(isOpenOrder).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    return {
      order,
      profile: d.name && d.phone ? { name: d.name, phone: d.phone } : null,
      entitlements: d.entitlements ?? [],
      isAdmin: u.isAdmin,
      now: Date.now(),
    };
  });
}
