import { db, ensureUserDoc, handle, requireUser, trialKey } from "@/lib/server/admin";
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
    // the order / payment gateway is for the FIRST time only: remember it even if the subscription row was removed later
    let everSubscribed = !!d.subscribed || (d.entitlements ?? []).length > 0;
    if (!everSubscribed) everSubscribed = !(await db().collection("codes").where("usedBy", "==", u.uid).limit(1).get()).empty;
    const trialUsed = (await db().collection("trials").doc(trialKey(u)).get()).exists; // also true if the user record was deleted and recreated
    return {
      order,
      everSubscribed,
      trialUsed: !!d.trialUsedAt || trialUsed,
      profile: d.name && d.phone ? { name: d.name, phone: d.phone } : null,
      entitlements: d.entitlements ?? [],
      isAdmin: u.isAdmin,
      now: Date.now(),
    };
  });
}
