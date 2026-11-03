import { db, handle, requireUser } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who am I: profile (teacher name + phone), my subscriptions, and whether I am the admin.
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const ref = db().collection("users").doc(u.uid);
    const snap = await ref.get();
    let d = snap.data();
    if (!d) {
      d = { uid: u.uid, email: u.email, displayName: u.name, photoURL: u.picture, name: "", phone: "", createdAt: Date.now(), entitlements: [] };
      await ref.set(d);
    }
    return {
      profile: d.name && d.phone ? { name: d.name, phone: d.phone } : null,
      entitlements: d.entitlements ?? [],
      isAdmin: u.isAdmin,
      now: Date.now(),
    };
  });
}
