import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const SCHEMA = {
  type: "OBJECT",
  properties: { pages: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["pages"],
};

const PROMPT = `You are an OCR engine. The images are consecutive pages of a scanned book (Arabic and/or English).
Transcribe ALL the text on each page exactly as written, in reading order (right-to-left for Arabic), keeping line breaks.
Keep question numbers and answer choices (أ ب ج د / A B C D) exactly as they appear.
Do not translate, summarise, correct or describe pictures. If a page has no text, return an empty string.
Return one string per image, in the same order as the images.`;

function classify(status: number, body: any) {
  const err = body?.error ?? {};
  const msg = String(err.message ?? "");
  let retryAfter: number | undefined;
  let day = /per ?day/i.test(msg);
  for (const d of Array.isArray(err.details) ? err.details : []) {
    const type = String(d?.["@type"] ?? "");
    if (type.endsWith("RetryInfo") && d.retryDelay) retryAfter = Math.ceil(parseFloat(d.retryDelay)) || undefined;
    if (type.endsWith("QuotaFailure")) {
      for (const v of d.violations ?? []) if (/perday/i.test(`${v.quotaId ?? ""}${v.quotaMetric ?? ""}`.replace(/[^a-z]/gi, ""))) day = true;
    }
  }
  if (status === 429) {
    return day
      ? { http: 429, code: "rate_day", error: "انتهى الحد اليومي المجاني للذكاء الاصطناعي" }
      : { http: 429, code: "rate_minute", retryAfter: retryAfter ?? 30, error: "وصلنا حد الطلبات في الدقيقة" };
  }
  if (status === 503 || status === 500) return { http: 503, code: "busy", retryAfter: 8, error: "خدمة الذكاء الاصطناعي مزدحمة حاليًا" };
  if (status === 403 || /api key/i.test(msg)) return { http: 502, code: "bad_key", error: "مفتاح API غير صالح أو غير مفعّل" };
  return { http: 502, code: "error", error: `خطأ من خدمة الذكاء الاصطناعي (${status})` };
}

let thinkingUnsupported = false;

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ code: "no_key", error: "مفتاح GEMINI_API_KEY غير موجود" }, { status: 500 });

  let body: { images?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ code: "bad_request", error: "طلب غير صالح" }, { status: 400 }); }
  const images = (Array.isArray(body.images) ? body.images : []).filter((x): x is string => typeof x === "string" && x.length > 100 && x.length < 3_000_000);
  if (!images.length || images.length > 4) return NextResponse.json({ code: "bad_request", error: "صور غير صالحة" }, { status: 400 });

  const call = (noThinking: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      signal: req.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, ...images.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } }))] }],
        generationConfig: {
          responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 16384, temperature: 0,
          ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
    });

  let res: Response;
  try {
    res = await call(!thinkingUnsupported);
    if (res.status === 400 && !thinkingUnsupported && /think/i.test(await res.clone().text())) {
      thinkingUnsupported = true;
      res = await call(false);
    }
  } catch {
    return NextResponse.json({ code: "network", error: "تعذّر الاتصال بخدمة الذكاء الاصطناعي" }, { status: 502 });
  }

  if (!res.ok) {
    let j: unknown = {};
    try { j = await res.json(); } catch {}
    const c = classify(res.status, j);
    return NextResponse.json({ code: c.code, error: c.error, retryAfter: (c as { retryAfter?: number }).retryAfter }, { status: c.http });
  }

  try {
    const j: any = await res.json();
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    const parsed = JSON.parse(text);
    const texts: string[] = Array.isArray(parsed.pages) ? parsed.pages.map((x: unknown) => String(x ?? "")) : [];
    while (texts.length < images.length) texts.push("");
    return NextResponse.json({ texts: texts.slice(0, images.length) });
  } catch {
    return NextResponse.json({ code: "parse", error: "تعذّر فهم رد الذكاء الاصطناعي عند قراءة الصفحات" }, { status: 502 });
  }
}
