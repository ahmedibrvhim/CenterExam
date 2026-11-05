import { endTrial } from "@/lib/server/trial";
import { handle, requireUser } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the app (AccessProvider.finishTrial) right after the trial user's FIRST PDF is downloaded.
// Expires the trial entitlement on the server so the subjects lock. Paid subscribers and admins are never touched (see endTrial).
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const ended = await endTrial(u);
    return { ok: true, ended };
  });
}
