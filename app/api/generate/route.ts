import { NextResponse } from "next/server";
import type { Q } from "@/exam";

export const runtime = "nodejs";
export const maxDuration = 60;

// "gemini-flash-latest" always points to the current free Flash model. Override with GEMINI_MODEL if needed.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const KINDS = ["mcq", "tf", "essay"] as const;
const LEVELS: Record<string, string> = {
  easy: "easy: direct recall of definitions and facts stated in the text",
  medium: "medium: understanding and applying ideas from the text",
  hard: "hard: analysis, comparison, cause and effect, multi-step reasoning based on the text",
  mixed: "a mix of easy, medium and hard",
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: [...KINDS] },
          text: { type: "STRING", description: "The question. Must make sense on its own." },
          choices: { type: "ARRAY", items: { type: "STRING" }, description: "mcq: exactly 4 options, no letter labels. tf and essay: empty array." },
          answer: { type: "STRING", description: "mcq: the exact text of the correct choice. tf: 'true' or 'false'. essay: a short model answer." },
          explanation: { type: "STRING", description: "One sentence showing where the text supports the answer." },
        },
        required: ["type", "text", "choices", "answer", "explanation"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM = `You are an experienced exam writer for teachers.
Write exam questions using ONLY the text the user gives you. Never add facts from outside it.
Rules:
- Write in the same language as the text (Arabic text -> Arabic questions).
- Every question must stand alone: never say "according to the text", "the passage", "the author" or mention page numbers.
- mcq: exactly 4 choices, exactly one correct, three plausible wrong ones. No "all of the above" / "none of the above". Do not put A/B/C/D or أ/ب/ج/د in the choices. The answer must be copied exactly from one choice.
- tf: a clear statement that is fully true or fully false. answer is "true" or "false". Mix true and false.
- essay: an open question answered in 2-4 sentences. answer is a short model answer.
- Skip tables of contents, indexes, references, headers and other filler. If the text has too little real content, return fewer questions rather than inventing.
- Do not repeat the same idea twice.`;

type Raw = { type?: string; text?: string; choices?: unknown; answer?: string; explanation?: string };

function cleanOne(r: Raw, allowed: string[]): Q | null {
  const kind = r.type as Q["kind"];
  const text = (r.text ?? "").trim();
  if (!text || !allowed.includes(kind)) return null;
  const explanation = (r.explanation ?? "").trim();
  const answer = (r.answer ?? "").trim();
  if (kind === "mcq") {
    const choices = [...new Set((Array.isArray(r.choices) ? r.choices : []).map((c) => String(c).trim()).filter(Boolean))];
    if (choices.length < 3 || !choices.includes(answer)) return null;
    return { kind, text, choices, answer, explanation };
  }
  if (kind === "tf") {
    const a = answer.toLowerCase();
    if (a !== "true" && a !== "false") return null;
    return { kind, text, choices: [], answer: a, explanation };
  }
  return { kind: "essay", text, choices: [], answer, explanation };
}

// Pulls complete {...} question objects out of a JSON text that arrives in small pieces.
// Depth 1 is the outer { "questions": [...] }, depth 2 is one question.
class ObjectExtractor {
  private depth = 0; private inStr = false; private esc = false; private start = -1; private buf = "";
  push(chunk: string): string[] {
    const out: string[] = [];
    for (const ch of chunk) {
      const i = this.buf.length;
      this.buf += ch;
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (ch === "\\") this.esc = true;
        else if (ch === '"') this.inStr = false;
        continue;
      }
      if (ch === '"') this.inStr = true;
      else if (ch === "{") { this.depth++; if (this.depth === 2) this.start = i; }
      else if (ch === "}") {
        if (this.depth === 2 && this.start >= 0) { out.push(this.buf.slice(this.start, i + 1)); this.start = -1; }
        this.depth = Math.max(0, this.depth - 1);
      }
    }
    return out;
  }
}

// Turn a Gemini error into something the app can act on: per-minute vs per-day limit, overload, bad key...
function classify(status: number, body: any) {
  const err = body?.error ?? {};
  const msg: string = String(err.message ?? "");
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
  if (status === 404) return { http: 502, code: "bad_model", error: "النموذج غير موجود. غيّر GEMINI_MODEL في ملف .env.local" };
  if (status === 403 || /api key/i.test(msg)) return { http: 502, code: "bad_key", error: "مفتاح API غير صالح أو غير مفعّل" };
  return { http: 502, code: "error", error: `خطأ من خدمة الذكاء الاصطناعي (${status})` };
}

let thinkingUnsupported = false; // learned at runtime: some models reject thinkingBudget: 0

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ code: "no_key", error: "مفتاح GEMINI_API_KEY غير موجود. أضفه في ملف .env.local ثم أعد تشغيل الخادم." }, { status: 500 });

  let body: { context?: string; n?: number; types?: string[]; difficulty?: string; topic?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ code: "bad_request", error: "طلب غير صالح" }, { status: 400 }); }

  const context = (body.context ?? "").slice(0, 24000);
  const n = Math.min(15, Math.max(1, Math.floor(Number(body.n) || 5)));
  const types = (body.types ?? []).filter((t) => (KINDS as readonly string[]).includes(t));
  if (context.trim().length < 200 || !types.length) return NextResponse.json({ code: "bad_request", error: "النص قصير جدًا أو لم تُحدَّد أنواع الأسئلة" }, { status: 400 });
  const level = LEVELS[body.difficulty ?? "mixed"] ?? LEVELS.mixed;
  const topic = (body.topic ?? "").trim().slice(0, 200);

  const prompt = `Write exactly ${n} questions.
Allowed types: ${types.join(", ")} (spread them roughly evenly).
Difficulty: ${level}.
${topic ? `Focus on this topic: ${topic}\n` : ""}
TEXT:
"""
${context}
"""`;

  const ctrl = new AbortController();
  req.signal.addEventListener("abort", () => ctrl.abort());

  const call = (noThinking: boolean) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 8192,
          // "thinking" makes Flash models several times slower; for writing questions from a given text we don't need it.
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

  // From here on we stream newline-delimited JSON to the browser: {"t":"q","q":{...}} per question, then {"t":"done"} or {"t":"err"}.
  const enc = new TextEncoder(), dec = new TextDecoder();
  const reader = res.body!.getReader();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const ext = new ObjectExtractor();
      let count = 0, buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            let j: any;
            try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
            const piece = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
            for (const obj of ext.push(piece)) {
              let raw: Raw;
              try { raw = JSON.parse(obj); } catch { continue; }
              const q = cleanOne(raw, types);
              if (q) { count++; send({ t: "q", q }); }
            }
          }
        }
        if (count) send({ t: "done", count });
        else send({ t: "err", code: "empty", message: "لم ينجح النموذج في كتابة أسئلة من هذا الجزء من النص" });
      } catch {
        if (!ctrl.signal.aborted) send({ t: "err", code: "stream", message: "انقطع الاتصال بالنموذج أثناء الكتابة" });
      } finally {
        try { controller.close(); } catch {}
      }
    },
    cancel() { ctrl.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
