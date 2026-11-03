import { db, handle, requireAdmin } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    const [codes, users] = await Promise.all([
      db().collection("codes").orderBy("createdAt", "desc").limit(1000).get(),
      db().collection("users").limit(2000).get(),
    ]);
    return {
      now: Date.now(),
      codes: codes.docs.map((d) => d.data()),
      users: users.docs.map((d) => {
        const x = d.data();
        return { uid: x.uid ?? d.id, email: x.email ?? "", displayName: x.displayName ?? "", photoURL: x.photoURL ?? "", name: x.name ?? "", phone: x.phone ?? "", createdAt: x.createdAt ?? 0, entitlements: x.entitlements ?? [] };
      }),
    };
  });
}
