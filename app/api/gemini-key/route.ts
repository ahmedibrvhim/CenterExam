import { ApiError, handle, readJson, requireUser } from "@/lib/server/admin";
import { checkGeminiKey, deleteUserKey, keyInfo, looksLikeGeminiKey, saveUserKey } from "@/lib/server/userKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: do I have my own key? (never returns the key, only its last 4 characters)
export async function GET(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    return await keyInfo(u);
  });
}

// POST { key }: check it with Google, then save it (encrypted)
export async function POST(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    const b = await readJson<{ key?: string }>(req);
    const key = String(b.key ?? "").trim().replace(/^["']|["']$/g, "");
    if (!looksLikeGeminiKey(key)) throw new ApiError(400, "bad_key_format", "المفتاح غير مكتمل أو فيه مسافات. انسخه كاملًا من Google AI Studio.");
    if ((await checkGeminiKey(key)) === "bad") throw new ApiError(400, "bad_key", "رفضت Google هذا المفتاح (غير صالح). تأكد أنك نسخته كاملًا من Google AI Studio.");
    await saveUserKey(u, key);
    return { ok: true, hasOwn: true, last4: key.slice(-4) };
  });
}

// DELETE: remove my key
export async function DELETE(req: Request) {
  return handle(async () => {
    const u = await requireUser(req);
    await deleteUserKey(u);
    return { ok: true, hasOwn: false, last4: "" };
  });
}
