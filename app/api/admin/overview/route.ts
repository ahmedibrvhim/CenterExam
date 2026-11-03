import { adminEmails, db, handle, requireAdmin } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin(req);
    // codes + users are required; if the orders query fails the page still opens (empty orders + a warning) instead of going blank
    const [codes, users, orders] = await Promise.allSettled([
      db().collection("codes").orderBy("createdAt", "desc").limit(1000).get(),
      db().collection("users").limit(2000).get(),
      db().collection("orders").orderBy("createdAt", "desc").limit(1000).get(),
    ]);
    if (codes.status === "rejected") throw codes.reason;
    if (users.status === "rejected") throw users.reason;
    if (orders.status === "rejected") console.error("orders query failed", orders.reason);
    const admins = adminEmails(); // the owner is not a customer: no subscriber row, no revenue
    return {
      now: Date.now(),
      admins,
      codes: codes.value.docs.map((d) => d.data()),
      orders: orders.status === "fulfilled" ? orders.value.docs.map((d) => d.data()) : [],
      warning: orders.status === "rejected" ? `تعذّر تحميل الطلبات: ${String((orders.reason as any)?.message ?? orders.reason).slice(0, 200)}` : "",
      users: dedupe(users.value.docs.filter((d) => !admins.includes(String(d.data().email ?? "").toLowerCase())).map((d) => {
        const x = d.data();
        return { uid: x.uid ?? d.id, email: x.email ?? "", displayName: x.displayName ?? "", photoURL: x.photoURL ?? "", name: x.name ?? "", phone: x.phone ?? "", createdAt: x.createdAt ?? 0, entitlements: x.entitlements ?? [] };
      })),
    };
  });
}

// one row per e-mail (older duplicates from a deleted + recreated Auth account are hidden; they merge on that person's next login)
function dedupe<T extends { email: string; name: string; entitlements: { expiresAt: number }[]; createdAt: number }>(list: T[]): T[] {
  const best = new Map<string, T>();
  const score = (u: T) => Math.max(0, ...u.entitlements.map((e) => e.expiresAt)) * 10 + (u.name ? 1 : 0);
  for (const u of list) {
    const k = u.email || Math.random().toString();
    const b = best.get(k);
    if (!b || score(u) > score(b)) best.set(k, u);
  }
  return [...best.values()];
}
