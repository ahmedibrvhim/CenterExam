import { handle, requireUser } from "@/lib/server/admin";
import { endTrial } from "@/lib/server/trial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The teacher downloaded the first PDF of the free trial -> the trial ends (only if they are on the trial alone).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return { ok: true, ended: await endTrial(u) };
  });
}
