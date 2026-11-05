import { NextResponse } from "next/server";
import { classify } from "@/lib/geminiErrors";
import { ApiError, assertSubjectAccess, requireUser } from "@/lib/server/admin";
import { getUserKey } from "@/lib/server/userKey";

// HIGH-ACCURACY PAGE READER (Arabic grammar books).
// Tesseract (the free reader in the browser) loses diacritics and mixes up ه/ة and أ/ا on a grammar page. This route sends ONE page picture
// to Gemini with the teacher's OWN key and returns the exact text. The browser uses it only for the Arabic subject, one page at a time, and
// falls back to Tesseract for any page that fails here (no key, limit reached, blocked page...), so reading a book never stops because of it.
export const runtime = "nodejs";
export const maxDuration = 60;

const MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"];
const MAX_B64 = 3_600_000; // ~2.7 MB of JPEG: the platform body limit is 4.5 MB

const PROMPT = `You are the OCR engine of a school-book reader. The picture is ONE page of an Arabic school book (Arabic language: grammar / نحو, morphology, reading, rhetoric).
Write down ALL the text of the page exactly as it is printed, in reading order (Arabic is read right to left; when the page has two columns, read the right column first, then the left one).

Rules:
- Copy, never correct. Keep every diacritic (التشكيل: فتحة، ضمة، كسرة، سكون، شدة، تنوين) exactly where it is printed, and never add one that is not printed. Keep the hamza, the تاء المربوطة and the ألف المقصورة exactly as printed.
- Grammar tables and two-column exercises: one table row per line, cells separated by " | ".
- Keep the exercise numbers, the letters أ ب ج د, the brackets ( ) and « » and the quotation marks exactly as printed. Words between brackets in إعراب questions must stay between brackets.
- Poetry: one verse (بيت) per line; keep the two halves of a verse on the same line separated by "   ".
- English words, numbers and symbols stay as they are. Do not translate. Do not summarise. Do not explain.
- Titles and headings each on their own line.
- Pictures, maps and drawings: write nothing for them, but DO write the text that is printed inside or next to them (labels, captions).
- Page numbers and running headers are written too, on their own line.
Output ONLY the page text. No introduction, no markdown, no code fence.`;

const send = (status: number, o: object) => NextResponse.json(o, { status });

export async function POST(req: Request) {
  let body: { image?: string; subject?: string };
  let key: string | null = null;
  try {
    const u = await requireUser(req);
    body = await req.json();
    const subject = String(body.subject ?? "");
    if (!["arabic", "social", "english"].includes(subject)) return send(400, { code: "bad_request", error: "هذه المادة لا تستخدم القراءة عالية الدقة" });
    await assertSubjectAccess(u, subject);
    key = (await getUserKey(u))?.key ?? null;
  } catch (e) {
    if (e instanceof ApiError) return send(e.status, { code: e.code, error: e.message });
    return send(400, { code: "bad_request", error: "طلب غير صالح" });
  }
  if (!key) return send(400, { code: "no_key", error: "لم تضف مفتاح Gemini بعد." });
  const image = String(body.image ?? "").replace(/^data:image\/jpeg;base64,/, "");
  if (image.length < 2000 || image.length > MAX_B64 || !/^[A-Za-z0-9+/=]+$/.test(image)) return send(400, { code: "bad_request", error: "صورة الصفحة غير صالحة" });

  let last: { http: number; code: string; error: string; retryAfter?: number } = { http: 502, code: "error", error: "تعذّرت قراءة الصفحة" };
  for (const model of MODELS) {
    for (const thinking of [{ thinkingBudget: 0 }, null]) {
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          signal: AbortSignal.timeout(45_000),
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType: "image/jpeg", data: image } }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8192, ...(thinking ? { thinkingConfig: thinking } : {}) },
          }),
        });
      } catch {
        last = { http: 504, code: "timeout", error: "استغرقت قراءة الصفحة وقتًا طويلًا", retryAfter: 2 };
        break; // another model
      }
      if (res.status === 400 && thinking) { const t = await res.clone().text(); if (!/api key/i.test(t)) continue; } // this model rejects "thinking off": try without it
      let j: any = {};
      try { j = await res.json(); } catch {}
      if (!res.ok) {
        const e = classify(res.status, j);
        last = e;
        if (e.code === "bad_key" || e.code === "rate_day") return send(e.http, { code: e.code, error: e.error });
        break; // busy / per-minute / retired model: the next model has its own quota
      }
      const cand = j.candidates?.[0];
      const text = (cand?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (!text) {
        // the model refused (RECITATION / SAFETY): another model may answer, otherwise the browser reads this page with Tesseract
        last = { http: 422, code: "blocked", error: `لم يُرجع النموذج نصًا (${cand?.finishReason ?? "empty"})` };
        break;
      }
      const clean = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
      return send(200, { text: clean, model });
    }
  }
  return send(last.http, { code: last.code, error: last.error, retryAfter: last.retryAfter });
}
