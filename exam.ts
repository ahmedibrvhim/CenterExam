import { CENTER_NAME, LOGO_DATA_URI } from "@/lib/logo";
import { WM_ASPECT, WM_DATA_URI } from "@/lib/watermark";
import { ALL_KINDS, getSubject, kindOrder, sectionTitle, type Kind } from "@/lib/subjects";
import { cleanMathText, linesFrom, readMathPage, type Engine, type Gray } from "@/lib/mathocr";
import { fixArabicPage } from "@/lib/arabicFix";
import { authFetch } from "@/lib/authFetch";
export type Q = {
  text: string; choices: string[]; kind: Kind; answer?: string; explanation?: string;
  mapId?: string; // "map" questions: the id of the map picture (Exam.maps) printed above them
};
export type Exam = {
  id: string; title: string; sources: string[]; questions: Q[];
  versions: string[]; seed: number; shuffleQ: boolean; shuffleA: boolean; date: string;
  createdAt: number; info?: string;
  ownerUid?: string; // the account that made it: the library only shows a teacher his own exams (older exams have none and are not shown)
  sets?: Q[][]; // one DIFFERENT set of questions per version (sets[i] belongs to versions[i]). Missing in exams saved by older releases.
  subject?: string; stage?: string; // set by the subject picker (older exams have none)
  grade?: string; // total mark the teacher typed (printed in the "الدرجة" box); no marks are printed per question
  maps?: Record<string, string>; // map pictures cut out of the book (social studies): id -> JPEG data URL; the "map" questions point at them with mapId
};

// Who prints the exam: shown in the footer of every page of the PDF (the name and phone the teacher gave when subscribing).
export type Teacher = { name: string; phone: string };

// ---------- 1) read text from a PDF (in the browser), one string per page ----------
export async function extractPages(file: File, onProgress?: (done: number, total: number) => void): Promise<string[]> {
  // @ts-ignore - pdfjs-dist 3.x ships without usable types for this path
  const pdfjs: any = await import("pdfjs-dist/build/pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = (await page.getTextContent()).items as any[];
      const lines: string[] = [];
      let y: number | null = null, line = "";
      for (const it of items) {
        const ny = it.transform[5];
        if (y !== null && Math.abs(ny - y) > 3) { lines.push(line); line = ""; }
        line += it.str; y = ny;
      }
      lines.push(line);
      pages.push(lines.join("\n"));
      page.cleanup(); // free the page's memory - important for books of hundreds of MB
      if (p % 10 === 0 || p === doc.numPages) {
        onProgress?.(p, doc.numPages);
        await new Promise((r) => setTimeout(r, 0)); // let the browser repaint
      }
    }
  } finally { doc.destroy?.(); }
  return pages;
}

// A page with (almost) no text layer is a scan: it is only a picture of a page.
export const isBlankPage = (t: string) => t.replace(/\s/g, "").length < 25;

export class OcrError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// ---------- 1a) scanned pages: render them as images and read them with Tesseract OCR ----------
// Runs entirely in the browser (free, no API key, no quota, the book never leaves the computer).
// nums are 1-based page numbers. Returns the text for each page that was read successfully.
const IS_MOBILE = typeof navigator !== "undefined" && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.platform)));
const PARALLEL = IS_MOBILE ? 1 : Math.max(1, Math.min(3, Math.floor((typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4) / 2))); // OCR workers (each holds ~100+ MB): computers half the cores (1-3), phones 1
// Arabic letters differ by small dots (ب ت ث ن ي): at a low resolution the dots vanish and "يبدأ" is read as "يدا".
// So the page is given to the OCR at a high resolution (about 300 dpi on a computer). Phones use less to save memory.
const OCR_WIDTH = IS_MOBILE ? 1700 : 2400;

// Tesseract adds invisible direction marks to mixed Arabic/English text - remove them.
const cleanOcr = (t: string) =>
  t.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .split("\n")
    // in mixed Arabic/English pages Tesseract can put an English question's number at the end ("text? .2")
    .map((l) => (/[\u0600-\u06FF]/.test(l) ? l : l.replace(/^(.*\S)\s+[.)]\s?(\d{1,3})\s*$/, "$2. $1")).replace(/[ \t]+$/, ""))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();

// Prepares the page picture for the OCR: grey scale, then stretch the contrast so the text is black and the paper white.
// Faint dots and thin strokes (very common in Arabic) survive much better this way. No hard black/white cut: Tesseract does that itself.
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  try {
    const img = ctx.getImageData(0, 0, w, h), d = img.data, hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
    const total = w * h; let acc = 0, lo = 0, hi = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.005) { lo = i; break; } }  // darkest 0.5% -> black
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= total * 0.25) { hi = i; break; } }   // paper level (a page is mostly paper)
    if (hi - lo < 40) return; // nothing to stretch (already flat) - keep the picture as it is
    const k = 255 / (hi - lo), lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.max(0, Math.min(255, (i - lo) * k));
    for (let i = 0; i < d.length; i += 4) { const v = lut[d[i]]; d[i] = d[i + 1] = d[i + 2] = v; }
    ctx.putImageData(img, 0, 0);
  } catch {}
}

// ---- math pages: fractions, roots and powers are found in the picture and read separately (lib/mathocr.ts) ----
function grayOf(canvas: HTMLCanvasElement): Gray {
  const { width: w, height: h } = canvas, d = canvas.getContext("2d")!.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
  return { data: g, w, h };
}
function canvasOf(g: Gray): HTMLCanvasElement {
  const c = document.createElement("canvas"); c.width = g.w; c.height = g.h;
  const ctx = c.getContext("2d")!, img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.data.length; i++) { const v = g.data[i]; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}
const mathEngine = (w: any): Engine => ({
  async recognize(g, mode, whitelist) {
    // "page": lines of text in one block (keeps a lone "+" or "=" that auto layout would throw away); "line": one line
    await w.setParameters({ tessedit_pageseg_mode: mode === "line" ? "7" : "6", tessedit_char_whitelist: whitelist ?? "" });
    const c = canvasOf(g);
    try { const { data } = await w.recognize(c, {}, { blocks: true }); return linesFrom(data); }
    finally { c.width = c.height = 0; }
  },
});

// ---- AI page reader (Arabic grammar books): see app/api/ocr/route.ts. One page at a time, ~6.5 s apart (the free limit is ~10 requests a minute). ----
const AI_GAP_MS = 6500;
const AI_STOP = new Set(["no_key", "bad_key", "rate_day", "no_access", "trial_limit", "bad_request"]); // after one of these the AI reader is not asked again in this run
function pageJpeg(canvas: HTMLCanvasElement, width = 1600): string {
  const s = Math.min(1, width / canvas.width);
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
  c.getContext("2d")!.drawImage(canvas, 0, 0, c.width, c.height);
  const d = c.toDataURL("image/jpeg", 0.85);
  c.width = c.height = 0;
  return d;
}

export async function ocrPages(
  file: File, nums: number[], signal: AbortSignal,
  hooks: {
    onProgress?: (done: number, total: number) => void; onRequest?: () => void; onWait?: (secs: number) => void; onPage?: (n: number, text: string) => void; math?: boolean;
    subject?: string;                                   // "arabic" -> grammar clean-up of the text and (with ai) the AI page reader
    ai?: boolean;                                       // read each page with the AI first (needs the teacher's Gemini key); Tesseract is the fallback for any page
    onAi?: (state: "off", why: string) => void;         // the AI reader was switched off for the rest of this run (no key / daily limit ...)
  } = {},
): Promise<Record<number, string>> {
  // @ts-ignore - pdfjs-dist 3.x ships without usable types for this path
  const pdfjs: any = await import("pdfjs-dist/build/pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
  const { createWorker } = await import("tesseract.js");
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const out: Record<number, string> = {};
  let finished = 0, failed = 0, next = 0, setupFailed = false;
  const workers: any[] = [];
  const arabic = hooks.subject === "arabic" && !hooks.math;
  // Arabic grammar pages carry small diacritics: a sharper page (about 360 dpi on a computer) keeps them
  const width = arabic ? Math.round(OCR_WIDTH * 1.25) : OCR_WIDTH;
  const dpi = arabic ? String(Math.min(400, Math.round(width / 8.27 / 10) * 10)) : "300";
  let aiOn = !!hooks.ai && !hooks.math && !!hooks.subject;
  let gate: Promise<void> = Promise.resolve(), lastAi = 0;

  const render = async (n: number): Promise<HTMLCanvasElement> => {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, width / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    enhance(ctx, canvas.width, canvas.height);
    return canvas;
  };

  // ask the AI reader for one page; null = use Tesseract for this page
  const aiRead = async (canvas: HTMLCanvasElement): Promise<string | null> => {
    if (!aiOn) return null;
    const turn = gate.then(async () => { const w = lastAi + AI_GAP_MS - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastAi = Date.now(); });
    gate = turn.catch(() => {});
    await turn;
    if (!aiOn || signal.aborted) return null;
    try {
      const res = await authFetch("/api/ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: pageJpeg(canvas), subject: hooks.subject }), signal });
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && typeof j.text === "string") {
        const letters = (j.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
        return letters >= 15 ? j.text : null;           // an empty / tiny answer is not a page: read it with Tesseract
      }
      if (AI_STOP.has(j.code)) { aiOn = false; hooks.onAi?.("off", j.code); }
      else if (j.code === "rate_minute") lastAi = Date.now() + Math.min(60, Number(j.retryAfter) || 30) * 1000; // wait out the minute limit, this page goes to Tesseract
      return null;
    } catch { if (signal.aborted) throw new Error("aborted"); return null; }
  };

  try {
    const count = Math.max(1, Math.min(aiOn ? 2 : PARALLEL, nums.length));
    const run = async () => {
      let w: any = null;
      // Tesseract starts only when a page needs it (a book read entirely by the AI reader never loads the 12 MB Arabic data)
      const tess = async () => {
        if (w) return w;
        try {
          w = await createWorker("ara+eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract", langPath: "/tessdata", gzip: false });
        } catch (e) { setupFailed = true; throw e; }
        workers.push(w);
        // keep real spaces between words, and tell the engine the real page resolution (it guesses badly otherwise)
        await w.setParameters({ preserve_interword_spaces: "1", user_defined_dpi: dpi }).catch(() => {});
        return w;
      };
      while (next < nums.length) {
        if (signal.aborted) throw new Error("aborted");
        const n = nums[next++];
        try {
          const canvas = await render(n);
          hooks.onRequest?.();
          let text: string | null = null;
          if (!hooks.math) text = await aiRead(canvas);
          if (text !== null) {
            out[n] = cleanOcr(text);                      // the AI copies the page exactly: no spelling rules are applied to it
          } else if (hooks.math) {
            const eng = await tess();
            const txt = cleanMathText(await readMathPage(mathEngine(eng), grayOf(canvas)));
            out[n] = cleanOcr(txt);
          } else {
            const { data } = await (await tess()).recognize(canvas);
            out[n] = arabic ? fixArabicPage(cleanOcr(data.text || "")) : cleanOcr(data.text || "");
          }
          canvas.width = canvas.height = 0;
          hooks.onPage?.(n, out[n]);
        } catch (e) {
          if (signal.aborted) throw e;
          failed++; // one bad page must not stop the whole run
        }
        finished++;
        hooks.onProgress?.(finished, nums.length);
      }
    };
    await Promise.all(Array.from({ length: count }, run));
  } catch (e) {
    if (signal.aborted) throw new Error("aborted");
    if (!Object.keys(out).length) throw new OcrError("error", "تعذّر تشغيل قارئ النصوص (OCR). تأكد من وجود المجلدين public/tesseract و public/tessdata ثم أعد المحاولة.");
  } finally {
    await Promise.all(workers.map((w) => w.terminate().catch(() => {})));
    doc.destroy?.();
  }
  if (signal.aborted) throw new Error("aborted");
  if (!Object.keys(out).length) throw new OcrError("error", setupFailed
    ? "تعذّر تشغيل قارئ النصوص (OCR). تأكد من وجود المجلدين public/tesseract و public/tessdata ثم أعد المحاولة."
    : "تعذّرت قراءة الصفحات الممسوحة.");
  return out;
}

// ---------- 1b) split pages into chunks, and pick the chunks the user cares about ----------
export type Chunk = { page: number; text: string };

export function chunkPages(pages: string[], from = 1, to = pages.length, size = 3200): Chunk[] {
  const out: Chunk[] = [];
  let buf = "", start = 1, fresh = 0;
  const OVERLAP = 5; // the last lines of a chunk are repeated at the start of the next one, so a heading/question is not cut off from its subject
  const flush = () => {
    if (fresh > 120) out.push({ page: start, text: buf.trim() });
    const tail = buf.split("\n").filter((l) => l.trim()).slice(-OVERLAP).join("\n");
    buf = tail ? tail + "\n" : ""; fresh = 0;
  };
  for (let p = Math.max(1, from); p <= Math.min(pages.length, to); p++) {
    for (const line of pages[p - 1].split("\n")) {
      if (!buf) start = p;
      buf += line + "\n"; fresh += line.replace(/\s/g, "").length;
      if (buf.length >= size) flush();
    }
  }
  if (fresh > 120) out.push({ page: start, text: buf.trim() });
  return out;
}

// light Arabic/English normalisation so "الخلية" matches "خلية" and "أ" matches "ا"
const stem = (w: string) => w.replace(/^(وال|بال|كال|فال|لل|ال)(?=.{2,})/, "");
export const tokens = (s: string): string[] =>
  s.toLowerCase().normalize("NFKC")
    .replace(/[\u064B-\u065F\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1).map(stem);

// No topic -> spread evenly over the whole range. Topic -> BM25 keyword ranking, best chunks first.
export function pickChunks(chunks: Chunk[], topic: string, k: number): Chunk[] {
  k = Math.min(k, chunks.length);
  const q = [...new Set(tokens(topic))];
  if (!q.length) {
    const idx = new Set<number>();
    for (let i = 0; i < k; i++) idx.add(Math.floor(((i + 0.5) * chunks.length) / k));
    return [...idx].sort((a, b) => a - b).map((i) => chunks[i]);
  }
  const docs = chunks.map((c) => tokens(c.text));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const N = docs.length;
  const idf = q.map((t) => { const df = docs.filter((d) => d.includes(t)).length; return Math.log(1 + (N - df + 0.5) / (df + 0.5)); });
  const scored = docs.map((d, i) => {
    const counts = new Map<string, number>();
    for (const w of d) counts.set(w, (counts.get(w) ?? 0) + 1);
    let score = 0;
    q.forEach((t, j) => { const tf = counts.get(t) ?? 0; if (tf) score += idf[j] * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg)))); });
    return { i, score };
  }).filter((x) => x.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, k).sort((a, b) => a.i - b.i).map((x) => chunks[x.i]);
}

// ---------- 2) versions ----------
// New exams store a DIFFERENT set of questions for every version (e.sets[i] belongs to e.versions[i]).
// Old exams (saved before this change) have no `sets`: their versions are the same questions shuffled with the seed.
export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(a: T[], r: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
export function buildVersion(e: Exam, idx: number): Q[] {
  if (idx === 0) return e.questions; // version A keeps the original order
  const r = rng(e.seed + idx * 7919);
  const qs = e.shuffleQ ? shuffle(e.questions, r) : e.questions;
  return qs.map((q) => (e.shuffleA && q.kind === "mcq" ? { ...q, choices: shuffle(q.choices, r) } : q));
}
export function versionQuestions(e: Exam, v: string): Q[] {
  const idx = Math.max(0, e.versions.indexOf(v));
  return e.sets ? e.sets[idx] ?? [] : buildVersion(e, idx);
}
export const examSets = (e: Exam): Q[][] => e.versions.map((v) => versionQuestions(e, v));

// Splits the questions that were written into one set per version.
// Every question is used once: each type is dealt out round-robin, so every version gets the same number of each type (+-1 if the AI wrote fewer than asked).
export function dealSets(pool: Q[], versions: number): Q[][] {
  const sets: Q[][] = Array.from({ length: versions }, () => []);
  for (const kind of ALL_KINDS) pool.filter((q) => q.kind === kind).forEach((q, i) => sets[i % versions].push(q));
  return sets;
}

// ---------- 3) PDF file ----------
// MATH: an expression such as "٣ + ٥ = ٨" or "٢س + ٣ = ١١" must keep its left-to-right order inside an Arabic line.
// Consecutive "math-looking" words are put in an LTR box (one box per word, laid out left-to-right with plain flex, so the order
// is identical in the browser and in the PDF picture). Sentence punctuation (. , : ، ؛ ؟ !) that follows a math run stays OUTSIDE the box,
// at the end of the sentence where it belongs. Everything is HTML-escaped here.
const MATHY = /^[0-9٠-٩a-zA-Z⁰¹²³⁴⁵⁶⁷⁸⁹⁻√∛π°%٪‰.,٫+\-−–×÷·∙*=<>≤≥≠≈±^\/():|{}\[\]∪∩∈∉⊂⊄⊆⊃⊇∅∞∠∥⊥△→←↔⇒⇔′″Δ]+$/;
const MATH_VAR = /^[٠-٩0-9.,٫]*[سصعمنلك][٠-٩0-9²³]*$/;
const MATH_OPS = /[+\-−–×÷·=<>≤≥≠≈±^\/√⁰¹²³⁴⁵⁶⁷⁸⁹∪∩∈∉⊂⊆∞{}|]/;
// invisible direction marks (LRM, RLM, embeddings, isolates, ALM, BOM, zero-width space) are removed: the AI and the OCR sometimes add them
// and they scramble the order of numbers and symbols.
const BIDI_MARKS = /[\u200B\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const RATIO = /^[\w٠-٩.,٫سصعمنلك]+(?:\s*[:=]\s*[\w٠-٩.,٫سصعمنلك]+)+$/;
const TAIL_PUNCT = /[.,٫:;،؛؟!?]+$/;
// The AI (and the OCR) often write the set signs with letters: "XNY" for X ∩ Y and "AUB" for A ∪ B. Turn them into the real signs.
const NOT_SETS = new Set(["AND", "END", "BUD", "CUD", "DUE", "ANY", "AXE", "EYE"]);
function setSigns(t: string): string {
  // (no look-behind in the pattern: older iPhones cannot even load a file that contains one)
  return t.replace(/(^|[^A-Za-z])([A-EX-Z](?:[NU][A-EX-Z])+)(?![A-Za-z])/g, (all, pre: string, m: string) =>
    NOT_SETS.has(m) ? all : pre + [...m].map((c, i) => (i % 2 ? (c === "N" ? " ∩ " : " ∪ ") : c)).join(""));
}
// Fixes the spacing of math text before it is drawn: "10 %" -> "10%", "( 3 + 4 )" -> "(3 + 4)", "x ²" -> "x²", "√ 25" -> "√25",
// "3 / 4" -> "3/4", "2+3=5" -> "2 + 3 = 5", "{5,6,7}" -> "{5, 6, 7}", "10 ؟" -> "10؟", and double spaces -> one space.
const TID_ATOM = "0-9٠-٩a-zA-Zسصعمنلك";
function tidyMath(t: string): string {
  return t.split("\n").map((l) => l
    .replace(new RegExp(`([${TID_ATOM})])[ \\t]+([%٪°‰])`, "g"), "$1$2")                       // 10 % -> 10%
    .replace(/([(\[{])[ \t]+/g, "$1").replace(/[ \t]+([)\]}])/g, "$1")                         // ( 3 ) -> (3)
    .replace(new RegExp(`([${TID_ATOM})%٪°‰])[ \\t]+(?=[.?؟!،,؛;](?:\\s|$))`, "g"), "$1")          // 10 ؟ -> 10؟
    .replace(new RegExp(`([${TID_ATOM})])[ \\t]+([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)`, "g"), "$1$2")                  // x ² -> x²
    .replace(/[ \t]*\^[ \t]*/g, "^")                                                            // x ^ 2 -> x^2
    .replace(/([⁰¹²³⁴⁵⁶⁷⁸⁹]+)[ \t]+√/g, "$1√").replace(/√[ \t]+(?=[0-9٠-٩a-zA-Z(])/g, "√")      // √ 25 -> √25
    .replace(new RegExp(`([${TID_ATOM})])[ \\t]*\\/[ \\t]*(?=[0-9٠-٩a-zA-Z(√])`, "g"), "$1/")        // 3 / 4 -> 3/4
    .replace(new RegExp(`([${TID_ATOM})%])[ \\t]*([+×÷=≠≈≤≥<>])[ \\t]*(?=[${TID_ATOM}(√−\\-π])`, "g"), "$1 $2 ") // 2+3=5 -> 2 + 3 = 5
    .replace(/\{[^{}]*\}/g, (g) => g.replace(/[ \t]*([,،])[ \t]*(?=\S)/g, "$1 "))                  // {5,6,7} -> {5, 6, 7}
    .replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ")                                                     // double spaces
  ).join("\n");
}
export function mathHtml(t: string): string {
  t = setSigns(tidyMath(t.replace(BIDI_MARKS, "")));
  return t.split("\n").map(mathLine).join("\n");
}
// splits at spaces, but never inside brackets, so "(6 ÷ 2)/(10 ÷ 2)" or "{5, 6, 7}" stays ONE word
function mathWords(t: string): string[] {
  const out: string[] = []; let cur = "", d = 0;
  for (const ch of t) {
    if ("([{".includes(ch)) d++; else if (")]}".includes(ch) && d > 0) d--;
    if (/\s/.test(ch) && d === 0) { if (cur) out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
// ---- right-to-left order ----------------------------------------------------------------------------------
// An Arabic page is read from the right, so math follows it: "108 ÷ 9 = 12" is drawn as "12 = 9 ÷ 108" (the first term sits on the right),
// "1 : 2" as "2 : 1", "{5, 6, 7}" as "{7 ,6 ,5}". Every number keeps its own digits left-to-right ("1,200" stays "1,200").
// To go back to the normal left-to-right order of equations, set MATH_RTL to false.
const MATH_RTL = true;
const MIRROR: Record<string, string> = { "<": ">", ">": "<", "≤": "≥", "≥": "≤", "⊂": "⊃", "⊃": "⊂", "⊆": "⊇", "⊇": "⊆", "∈": "∋", "∋": "∈", "←": "→", "→": "←", "⇐": "⇒", "⇒": "⇐" };
// the inside of every bracket pair is turned too (the brackets keep enclosing the text)
function flipGroups(w: string): string {
  let out = "";
  for (let i = 0; i < w.length;) {
    if ("([{".includes(w[i])) {
      let d = 0, k = i;
      for (; k < w.length; k++) { if ("([{".includes(w[k])) d++; else if (")]}".includes(w[k]) && --d === 0) break; }
      if (k < w.length) { out += w[i] + rtlWords(mathWords(w.slice(i + 1, k))).join(" ") + w[k]; i = k + 1; continue; }
    }
    out += w[i++];
  }
  return out;
}
function rtlWords(words: string[]): string[] {
  const parts = words.map((w) => {
    const m = /^(.*[^,،;])([,،;]+)$/.exec(w); // a list comma belongs to the word before it, so it travels to that word's left side
    return (m ? m[2] : "") + (MIRROR[m ? m[1] : w] ?? flipGroups(m ? m[1] : w));
  });
  return parts.reverse();
}
function mathLine(line: string): string {
  let out = "", run: string[] = [];
  const flush = () => {
    if (!run.length) return;
    const all = run.join("");
    const ws = /\s*$/.exec(all)![0]; // spaces after the run stay between the run and the next word
    let txt = all.slice(0, all.length - ws.length);
    run = [];
    const m = TAIL_PUNCT.exec(txt);
    let tail = "";
    if (m) { tail = m[0]; txt = txt.slice(0, m.index).replace(/\s+$/, ""); }
    if (txt) {
      // "2:3" / "6:10=9:15" written without spaces are split so the terms can be ordered
      const norm = RATIO.test(txt) && txt.includes(":") ? txt.replace(/\s*([:=])\s*/g, " $1 ").trim() : txt;
      let words = mathWords(norm);
      if (MATH_RTL && words.length > 1) words = rtlWords(words);
      else if (MATH_RTL) words = [flipGroups(words[0])];
      out += MATH_OPS.test(txt) || words.length > 1
        ? `<span class="mx" dir="ltr">${words.map((w) => `<span class="mw">${richMath(w)}</span>`).join("")}</span>`
        : richMath(words[0]);
    }
    out += esc(tail) + ws;
  };
  for (const p of line.split(/(\s+)/)) {
    if (!p) continue;
    if (/^\s+$/.test(p)) { if (run.length) run.push(p); else out += p; continue; }
    // sentence punctuation glued to the end of a word ("4،" "5." "x?") is split off and travels with the run (flush puts it outside)
    const m = /^(.*[^\s.,٫:;،؛؟!?])([.,٫:;،؛؟!?]+)$/.exec(p);
    const core = m ? m[1] : p;
    if (MATHY.test(core) || MATH_VAR.test(core)) { run.push(core); if (m) run.push(m[2]); }
    else { flush(); out += esc(p); }
  }
  flush();
  return out;
}

// ---- stacked fractions, roots and powers ------------------------------------------------------------------
// Notation (what the OCR in lib/mathocr.ts writes and what the question writer is told to use):
//   3/4   (2x + 1)/(x - 3)   -> stacked fraction      √25   √(x + 4)   ³√27 -> root with an overline (and index)
//   x²  x^3  x^(n+1)  10⁻²    -> power
const SUPMAP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "−" };
const ATOM = /^(?:[0-9٠-٩]+(?:[.٫][0-9٠-٩]+)?[a-zA-Zسصعمنلك]?|[a-zA-Zسصعمنلك])/;
// text of the balanced "( ... )" group that starts at i (returns the inner text and the index after the closing bracket)
function group(t: string, i: number): [string, number] | null {
  if (t[i] !== "(") return null;
  let d = 0;
  for (let k = i; k < t.length; k++) { if (t[k] === "(") d++; else if (t[k] === ")" && --d === 0) return [t.slice(i + 1, k), k + 1]; }
  return null;
}
function operand(t: string, i: number): [string, number] | null {
  const g = group(t, i); if (g) return g;
  const m = ATOM.exec(t.slice(i)); return m ? [m[0], i + m[0].length] : null;
}
export function richMath(t: string): string {
  let out = "";
  for (let i = 0; i < t.length;) {
    const c = t[i];
    // root, with an optional index written as superscript digits right before the sign
    const ix = /^[⁰¹²³⁴⁵⁶⁷⁸⁹]+√/.exec(t.slice(i));
    if (c === "√" || ix) {
      const idx = ix ? [...ix[0].slice(0, -1)].map((ch) => SUPMAP[ch]).join("") : "";
      const at = i + (ix ? ix[0].length : 1), o = operand(t, at);
      if (o) { out += `<span class="rt">${idx ? `<sup class="ri">${idx}</sup>` : ""}<span class="rs">√</span><span class="rd">${richMath(o[0])}</span></span>`; i = o[1]; continue; }
    }
    // fraction  a/b : the first operand must not be glued to a previous letter or digit
    if ((c === "(" || ATOM.test(t.slice(i))) && !/[A-Za-z0-9٠-٩.]/.test(t[i - 1] ?? "")) {
      const a = operand(t, i);
      if (a && t[a[1]] === "/") {
        const b = operand(t, a[1] + 1);
        if (b) { out += `<span class="fr"><span class="nu">${richMath(a[0])}</span><span class="de">${richMath(b[0])}</span></span>`; i = b[1]; continue; }
      }
    }
    // power: superscript digits, or ^n, ^(n+1)
    if (SUPMAP[c] !== undefined) { let k = i, v = ""; while (k < t.length && SUPMAP[t[k]] !== undefined) v += SUPMAP[t[k++]]; out += `<sup class="pw">${esc(v)}</sup>`; i = k; continue; }
    if (c === "^") { const o = operand(t, i + 1); if (o) { out += `<sup class="pw">${richMath(o[0])}</sup>`; i = o[1]; continue; } }
    if (c === "∩" || c === "∪") { out += `<span class="sx ${c === "∩" ? "ci" : "cu"}"></span>`; i++; continue; }
    out += esc(c); i++;
  }
  return out;
}
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const AR = ["أ", "ب", "ج", "د", "هـ", "و"], EN = ["A", "B", "C", "D", "E", "F"];

// Builds the exam as A4 "sheets" (HTML). key=false -> student copy (no answers). key=true -> same questions with the correct answers marked.
// The sheets are then photographed and put in a real PDF file (see buildPdf) - the browser print dialog is never used,
// so there are no extra lines, no blank pages and no differences between Chrome / Safari / phones.
const sectionsOf = (subject?: string): Array<{ kind: Q["kind"]; title: string }> => kindOrder(subject).map((k) => ({ kind: k, title: sectionTitle(subject, k) }));
const ORD_EN = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
// the English exam is printed in English: every English string is isolated (bdi) so punctuation and numbers keep their place inside the right-to-left sheet
const bdi = (t: string) => `<bdi dir="ltr">${esc(t)}</bdi>`;
const hashStr = (t: string) => { let h = 2166136261; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// label shown before the model answer of a written question (teacher copy)
const MODEL_LABEL_AR: Partial<Record<Kind, string>> = { reason: "التعليل", define: "التعريف", compare: "المقارنة", irab: "الإعراب", extract: "المستخرج", rhetoric: "الإجابة", list: "الإجابة", order: "الترتيب الصحيح", correct: "الصواب", rewrite: "الإجابة", vocab: "الإجابة", match: "التوصيل" };
const MODEL_LABEL_EN: Partial<Record<Kind, string>> = { order: "Correct order", correct: "Correct sentence", rewrite: "Rewritten sentence", vocab: "Answer", match: "Matching", essay: "Model answer" };
// how many answer lines a written question gets on the student copy
const LINES: Partial<Record<Kind, number>> = { irab: 2, rhetoric: 2, list: 3, rewrite: 2, essay: 1 };
// multi-line model answers keep their line breaks
const PRE_KINDS: Kind[] = ["compare", "list", "irab", "match"];
const ORD = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر"];

const SHEET_W = 210, SHEET_H = 296;    // mm: one A4 sheet
const M_TOP = 12, M_SIDE = 15;         // mm: sheet margins
const CONTENT_H = 266;                 // mm: usable height for the content on a sheet (the rest of the sheet is the footer: teacher name + phone)
const WM_W = 104;                      // mm: watermark width on the paper
const WM_H = WM_W / WM_ASPECT;         // mm
const WM_OPACITY = 0.07;               // faint enough to write over

// Cairo is served from this site (public/fonts), so the pages are measured and drawn with the SAME font on every phone and computer.
const fontCss = (origin: string) => {
  const AR_R = "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC";
  const LA_R = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  return [400, 600, 800].flatMap((w) => [["arabic", AR_R], ["latin", LA_R]].map(([sub, r]) =>
    `@font-face{font-family:CairoP;font-weight:${w};font-style:normal;font-display:block;src:url(${origin}/fonts/cairo-${sub}-${w}.woff2) format("woff2");unicode-range:${r}}`)).join("\n");
};

// A story question: the title, the story in a box, then its questions (a, b, c...) each with an answer line (or the model answer on the teacher's copy).
// q.text = the story (first line = title when it is short), q.choices = "question ||| answer" pairs.
function renderStory(q: Q, n: number, key: boolean): string {
  const lines = q.text.split("\n").map((x) => x.trim()).filter(Boolean);
  const title = lines.length > 1 && lines[0].length <= 70 && !/[.!?]$/.test(lines[0]) ? lines.shift()! : "";
  const body = lines.map((l) => `<p>${esc(l)}</p>`).join("");
  const subs = q.choices.map((c) => { const [a, ...r] = c.split("|||"); return [a.trim(), r.join("|||").trim()] as [string, string]; });
  const LET = ["a", "b", "c", "d", "e", "f"];
  const qs = subs.map(([a, b], i) => `<li><b>${LET[i] ?? i + 1}</b><div><span class="sqt">${esc(a)}</span>${key && b ? `<div class="model"><b>Answer:</b> ${esc(b)}</div>` : `<div class="ln"></div>`}</div></li>`).join("");
  return `<section dir="ltr"><p class="q"><span class="n">${n}</span><span class="qt">${esc(title || "Read the story and answer the questions:")}</span></p><div class="story">${body}</div><ol class="sq">${qs}</ol></section>`;
}

export function examHtml(e: Exam, v: string, key = false, teacher?: Teacher | null): string {
  const origin = typeof location !== "undefined" ? location.origin : "";
  const all = versionQuestions(e, v);
  // group by question type (MCQ, then true/false, then essay) and number continuously
  const en = getSubject(e.subject)?.lang === "en";
  const groups = sectionsOf(e.subject).map((s) => ({ ...s, qs: all.filter((q) => q.kind === s.kind) })).filter((g) => g.qs.length);
  let n = 0;
  const summary: string[] = [];

  // Layout rule: as compact as possible. MCQ choices share one row, true/false sits on the question's own row,
  // every written answer gets ONE line (or an inline blank), and the sections are tight.
  const blanks = (t: string) => esc(t).replace(/_{3,}/g, '<span class="bl"></span>');
  const isMath = e.subject === "math";
  const T = (t: string) => (isMath ? mathHtml(t) : esc(t));
  const renderQ = (q: Q) => {
    n++;
    if (q.kind === "story") return renderStory(q, n, key);
    const ar = /[؀-ۿ]/.test(q.text);
    const L = ar ? AR : EN;
    const tfAns = q.answer === "true" ? (ar ? "صح" : "True") : q.answer === "false" ? (ar ? "خطأ" : "False") : "";
    let extra = "", inline = "";
    if (q.kind === "mcq") {
      extra = `<ol class="c">${q.choices.map((c, k) => {
        const ok = key && c === q.answer;
        if (ok) summary.push(`<span><b>${n}</b><em>${L[k] ?? k + 1}</em></span>`);
        return `<li${ok ? ' class="ok"' : ""}><span class="l">${L[k] ?? k + 1}</span><span class="t">${T(c)}</span></li>`;
      }).join("")}</ol>`;
    } else if (q.kind === "tf") {
      if (key && tfAns) summary.push(`<span><b>${n}</b><em>${tfAns}</em></span>`);
      const yes = ar ? "صح" : "True", no = ar ? "خطأ" : "False";
      inline = `<span class="tf"><span class="opt${key && q.answer === "true" ? " on" : ""}"><span class="bx">${key && q.answer === "true" ? "✓" : ""}</span>${yes}</span><span class="opt${key && q.answer === "false" ? " on" : ""}"><span class="bx">${key && q.answer === "false" ? "✓" : ""}</span>${no}</span></span>`;
    } else if (q.kind === "solve") {
      extra = key && q.answer
        ? `<div class="model sol"><div class="sl"><b>الحل:</b></div>${q.answer.split("\n").map((l) => `<div class="sl">${T(l.trim()) || "&nbsp;"}</div>`).join("")}</div>`
        : `<div class="ln"></div><div class="ln"></div><div class="ln"></div>`;
    } else if (q.kind === "problem") {
      extra = key && q.answer ? `<div class="model pre"><b>الحل:</b>\n${esc(q.answer)}</div>` : `<div class="ln"></div><div class="ln"></div>`;
    } else if (q.kind === "balance" || q.kind === "write") {
      extra = key && q.answer
        ? `<div class="model eq"><b>المعادلة الموزونة:</b> <bdi dir="ltr">${esc(q.answer)}</bdi></div>`
        : `<div class="ln"></div>`;
    } else if (q.kind === "term" || q.kind === "vocab") {
      const lab = q.kind === "term" ? "المصطلح" : ar ? "الإجابة" : "Answer";
      if (key && q.answer) extra = `<div class="model"><b>${lab}:</b> ${ar ? esc(q.answer) : bdi(q.answer)}</div>`;
      else inline = `<span class="tl"></span>`;
    } else if (q.kind === "fill") {
      extra = key && q.answer ? `<div class="model"><b>${ar ? "الإجابة" : "Answer"}:</b> ${T(q.answer)}</div>` : "";
    } else if (q.kind === "match") {
      // two columns: the items of column A are numbered, the items of column B are lettered in a fixed scrambled order (the same on every print)
      const pairs = q.choices.map((c) => { const [a, ...r] = c.split("|||"); return [a.trim(), r.join("|||").trim()] as [string, string]; });
      let order = shuffle(pairs.map((_, i) => i), rng(hashStr(q.text + pairs.map((p) => p[0]).join("|"))));
      if (order.every((v, i) => v === i) && pairs.length > 1) order = [...order.slice(1), order[0]]; // never print the pairs side by side
      const letterOf = (i: number) => L[order.indexOf(i)] ?? "";
      const cell = (t: string) => (ar ? esc(t) : bdi(t));
      const left = pairs.map((p, i) => `<div class="mi"><b>${i + 1}</b><span class="mb">${key ? letterOf(i) : ""}</span><span>${cell(p[0])}</span></div>`).join("");
      const right = order.map((pi, k) => `<div class="mi"><b>${L[k] ?? k + 1}</b><span>${cell(pairs[pi][1])}</span></div>`).join("");
      extra = `<div class="mt"><div class="mc">${left}</div><div class="mc">${right}</div></div>`;
      if (key) extra += `<div class="model"><b>${ar ? "التوصيل" : "Matching"}:</b> ${pairs.map((_, i) => `${i + 1} ← ${letterOf(i)}`).join(ar ? " ، " : " , ")}</div>`;
    } else {
      const label = (ar ? MODEL_LABEL_AR[q.kind] : MODEL_LABEL_EN[q.kind]) ?? (ar ? "الإجابة النموذجية" : "Model answer");
      const pre = PRE_KINDS.includes(q.kind);
      const lines = Array.from({ length: LINES[q.kind] ?? 1 }, () => `<div class="ln"></div>`).join("");
      extra = key && q.answer ? `<div class="model${pre ? " pre" : ""}"><b>${label}:</b> ${pre ? "\n" : ""}${ar ? esc(q.answer) : bdi(q.answer)}</div>` : lines;
    }
    const why = key && q.explanation && ["mcq", "tf"].includes(q.kind) ? `<p class="why"><b>${ar ? "التفسير" : "Explanation"}:</b> ${isMath ? mathHtml(q.explanation) : esc(q.explanation)}</p>` : "";
    let qText = q.kind === "fill" ? (isMath ? mathHtml(q.text).replace(/_{3,}/g, '<span class="bl"></span>') : blanks(q.text)) : T(q.text), eqLine = "";
    if (q.kind === "match") qText = ar ? "اكتب حرف الإجابة المناسبة أمام كل رقم:" : "Write the letter of the answer next to each number:";
    if (q.kind === "order" && /[:：]/.test(q.text) && !/منطق/.test(q.text.split(/[:：]/)[0])) qText = T(q.text.split(/[:：]/).slice(1).join(":").trim());
    if (q.kind === "balance") {
      const m = q.text.match(/^([\s\S]*?[:：])\s*([^:：]+)$/);
      if (m) { qText = esc(m[1]); eqLine = `<div class="eqline" dir="ltr">${esc(m[2].trim())}</div>`; }
    }
    return `<section dir="auto"><p class="q"><span class="n">${n}</span><span class="qt">${qText}</span>${inline}</p>${eqLine}${extra}${why}</section>`;
  };

  // flat list of blocks (header, headings, questions). The pager measures them and fills the sheets.
  // map questions: the picture is printed ONCE above the questions that belong to it (the pager keeps the picture with its first question)
  const questionBlocks = (g: { kind: Q["kind"]; qs: Q[] }): string[] => {
    if (g.kind !== "map") return g.qs.map(renderQ);
    const byMap = new Map<string, Q[]>();
    for (const q of g.qs) { const id = q.mapId ?? ""; byMap.set(id, [...(byMap.get(id) ?? []), q]); }
    return [...byMap].flatMap(([id, list]) => {
      const src = e.maps?.[id];
      return [...(src ? [`<div class="mapbox"><img src="${src}" alt=""></div>`] : []), ...list.map(renderQ)];
    });
  };
  const groupBlocks = groups.flatMap((g, gi) => [
    en
      ? `<h2><span>${bdi(`Question ${ORD_EN[gi] ?? gi + 1}: ${g.title}`)}</span><span class="cnt">${bdi(`${g.qs.length} ${g.qs.length === 1 ? "question" : "questions"}`)}</span></h2>`
      : `<h2><span>السؤال ${ORD[gi] ?? ""}: ${g.title}</span><span class="cnt">${g.qs.length} ${g.qs.length === 1 ? "سؤال" : "أسئلة"}</span></h2>`,
    ...questionBlocks(g),
  ]);
  const total = all.length;
  const keyBox = key && summary.length ? `<div class="sum"><h3>${en ? bdi("Answer summary") : "ملخص الإجابات"}</h3><div class="grid">${summary.join("")}</div></div>` : "";
  const subj = getSubject(e.subject);
  const subjectName = subj ? (en ? bdi("English") : `مادة ${esc(subj.name)}`) : "";
  // footer of every sheet: the teacher who prints the exam (name + the phone he gave when he subscribed)
  const tName = (teacher?.name ?? "").trim(), tPhone = (teacher?.phone ?? "").trim();
  const footer = tName || tPhone
    ? `<div id="ft" class="foot">${tName ? `<span>${en ? bdi("Teacher:") : "المعلم:"} <b>${en ? bdi(tName) : esc(tName)}</b></span>` : "<span></span>"}${tPhone ? `<span>${en ? bdi("Phone:") : "الهاتف:"} <b>${bdi(tPhone)}</b></span>` : "<span></span>"}</div>`
    : "";
  const header = `<div class="hdr">
<div class="top">
  <div class="brand"><img src="${LOGO_DATA_URI}" alt=""><div><b>${CENTER_NAME}</b><small>${en ? bdi(key ? "Answer key" : "Exam paper") : key ? "نموذج الإجابة" : "ورقة اختبار"}</small></div></div>
  <div class="ttl">${subjectName ? `<span class="subj">${subjectName}</span>` : ""}<h1>${esc(e.title)}</h1></div>
  <div class="ver"><small>${en ? bdi("Model") : "النموذج"}</small><span>${v}</span></div>
</div>
${key ? "" : `<div class="info">
  <div class="w2"><i>${en ? bdi("Student's name:") : "اسم الطالب:"}</i><u></u></div>
  <div><i>${en ? bdi("Class:") : "الفصل:"}</i><u></u></div>
  <div class="sc"><i>${en ? bdi("Mark:") : "الدرجة:"}</i><span class="box"></span><span>/ ${esc(e.grade || String(total))}</span></div>
</div>`}
<div class="strip">
  <span>${en ? `<bdi dir="ltr">Number of questions: <b>${total}</b></bdi>` : `عدد الأسئلة: <b>${total}</b>`}</span>
  <span>${en ? `<bdi dir="ltr">Total mark: <b>${esc(e.grade || String(total))}</b></bdi>` : `الدرجة الكلية: <b>${esc(e.grade || String(total))}</b>`}</span>
  <span class="tip">${en ? bdi(key ? "Teacher's copy — contains the correct answers" : "Read every question carefully and answer all of them.") : key ? "نسخة المعلم — تحتوي على الإجابات الصحيحة" : "اقرأ كل سؤال بتمعّن قبل الإجابة، ولا تترك أي سؤال دون إجابة."}</span>
</div>
</div>`;
  const end = `<div class="end"><span>${en ? bdi(key ? "End of the answer key" : "End of the exam — Good luck!") : key ? "نهاية نموذج الإجابة" : "انتهت الأسئلة — مع تمنياتنا لكم بالتوفيق"}</span></div>`;

  // PAGER: runs inside the hidden exam page. Measures every block, then builds one .sheet per page:
  // [watermark image] + [the blocks that fit]. A heading is never left alone at the bottom of a sheet.
  const PAGER = `(function(){
var CAP=${CONTENT_H},started=false;
function imgsReady(){
  var im=document.images,ps=[];
  for(var i=0;i<im.length;i++){var x=im[i];if(!x.complete){ps.push(new Promise(function(r){x.onload=x.onerror=r;}));}}
  return Promise.all(ps);
}
function run(){
  if(started)return;started=true;
  var m=document.getElementById('measure'),out=document.getElementById('out'),wm=document.getElementById('wm');
  m.style.cssText='position:absolute;left:0;top:0;width:${SHEET_W - 2 * M_SIDE}mm;margin:0;visibility:hidden';
  var probe=document.createElement('div');
  probe.style.cssText='position:absolute;left:0;top:0;width:1px;height:100mm;visibility:hidden';
  document.body.appendChild(probe);
  var pxmm=probe.getBoundingClientRect().height/100;
  document.body.removeChild(probe);
  var cap=CAP*pxmm,blocks=Array.prototype.slice.call(m.children),base=m.getBoundingClientRect().top,tops=[],bots=[];
  blocks.forEach(function(b){var r=b.getBoundingClientRect();tops.push(r.top-base);bots.push(r.bottom-base);});
  var pages=[],cur=[],start=0;
  function fits(i){return bots[i]-tops[start]<=cap;}
  for(var i=0;i<blocks.length;i++){
    var ok=fits(i);
    if(ok&&(blocks[i].tagName==='H2'||blocks[i].className==='mapbox')&&i+1<blocks.length&&!fits(i+1))ok=false;
    if(!ok&&cur.length){pages.push(cur);cur=[];start=i;}
    cur.push(blocks[i]);
  }
  if(cur.length)pages.push(cur);
  pages.forEach(function(list,pi){
    var s=document.createElement('div');s.className='sheet';
    var w=wm.cloneNode(true);w.removeAttribute('id');s.appendChild(w);
    var ftEl=document.getElementById('ft');if(ftEl){var f=ftEl.cloneNode(true);f.removeAttribute('id');s.appendChild(f);}
    var c=document.createElement('div');c.className='content';
    list.forEach(function(b){c.appendChild(b);});s.appendChild(c);
    if(pi<pages.length-1&&list.length>1){
      var first=blocks.indexOf(list[0]),last=blocks.indexOf(list[list.length-1]);
      var left=cap-(bots[last]-tops[first]),gaps=0,k;
      for(k=1;k<list.length;k++){if(list[k-1].tagName!=='H2')gaps++;}
      if(gaps>0&&left>0){
        var add=Math.min(left/gaps,5*pxmm),off=0;
        for(k=1;k<list.length;k++){if(list[k-1].tagName!=='H2')off+=add;list[k].style.position='relative';list[k].style.top=off+'px';}
      }
    }
    out.appendChild(s);
  });
  m.parentNode.removeChild(m);
  document.documentElement.setAttribute('data-ready','1');
}
setTimeout(run,3500);
try{
  var sample='\\u0633\\u0646\\u062a\\u0631 \\u0627\\u0644\\u0646\\u0648\\u0631 ABC 123';
  Promise.all([document.fonts.load('400 14px CairoP',sample),document.fonts.load('600 14px CairoP',sample),document.fonts.load('800 14px CairoP',sample)])
    .then(imgsReady,imgsReady).then(function(){setTimeout(run,50);},function(){setTimeout(run,50);});
}catch(e){window.addEventListener('load',run);}
})();`;

  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(e.title)} - ${v} - ${key ? "مع الحل" : "بدون حل"}</title>
<style>
${fontCss(origin)}
@page{size:A4;margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;background:#fff;height:auto}
body{font-family:CairoP,Cairo,Tahoma,Arial,sans-serif;-webkit-text-size-adjust:100%;color:#111;font-size:13px;line-height:1.5}
#measure{margin:${M_TOP}mm ${M_SIDE}mm}
.sheet{position:relative;width:${SHEET_W}mm;height:${SHEET_H}mm;overflow:hidden;background:#fff;break-after:page;page-break-after:always}
.sheet:last-child{break-after:auto;page-break-after:auto}
.sheet>.wm{position:absolute;left:${(210 - WM_W) / 2}mm;top:${(297 - WM_H) / 2}mm;width:${WM_W}mm;height:${WM_H}mm;opacity:${WM_OPACITY};z-index:0;pointer-events:none}
#wm{display:none}
.content{position:absolute;z-index:1;left:${M_SIDE}mm;right:${M_SIDE}mm;top:${M_TOP}mm}
.content>:first-child{margin-top:0}

/* ---- header ---- */
.hdr{margin:0 0 9px}
.top{display:grid;grid-template-columns:1fr 1.5fr 1fr;align-items:center;gap:12px;padding:0 0 10px;border-bottom:3px double #111}
.brand{display:flex;align-items:center;gap:10px}.brand img{width:50px;height:50px}
.brand b{display:block;font-size:16px;font-weight:800;line-height:1.25}.brand small{display:block;font-size:11px;color:#444;font-weight:600}
.ttl{text-align:center}.ttl h1{margin:0;font-size:21px;font-weight:800;line-height:1.35}
.subj{display:inline-block;margin:0 0 5px;padding:1px 16px 2px;border:1.6px solid #111;border-radius:99px;background:#111;color:#fff;font-size:12.5px;font-weight:800;line-height:1.55}
.ver{justify-self:end;display:flex;flex-direction:column;align-items:center;gap:2px}
.ver small{font-size:10.5px;font-weight:700;color:#444}
.ver span{display:flex;align-items:center;justify-content:center;width:50px;height:50px;border:2.5px solid #111;border-radius:10px;background:#111;color:#fff;font-weight:800;font-size:28px;line-height:1}
.info{display:grid;grid-template-columns:2.4fr 1.4fr 1.4fr;gap:0 18px;margin-top:12px;font-size:12.5px}
.info div{display:flex;align-items:flex-end;gap:6px;min-height:26px}
.info i{font-style:normal;font-weight:800;white-space:nowrap}
.info u{flex:1;border-bottom:1.2px dotted #111;height:16px;text-decoration:none}
.info .dt{flex:1;border-bottom:1.2px dotted #111;text-align:center;font-weight:600;padding-bottom:1px}
.info .sc{gap:5px}.info .sc .box{width:44px;height:24px;border:1.5px solid #111;border-radius:4px;display:inline-block}
.strip{display:flex;flex-wrap:wrap;align-items:center;gap:4px 18px;margin-top:11px;padding:6px 12px;background:#efefef;border:1px solid #c9c9c9;border-radius:6px;font-size:12px}
.strip b{font-weight:800}.strip .tip{margin-right:auto;font-size:11.5px;color:#333}

/* ---- answer summary (teacher copy) ---- */
.sum{margin:0 0 14px;border:1.5px solid #111;border-radius:6px;padding:8px 10px}
.sum h3{margin:0 0 6px;font-size:13px;font-weight:800}
.sum .grid{display:flex;flex-wrap:wrap;gap:5px}
.sum .grid span{display:inline-flex;border:1px solid #111;border-radius:4px;overflow:hidden;font-size:12px;line-height:1.5}
.sum .grid b{background:#111;color:#fff;min-width:24px;text-align:center;padding:0 5px;font-weight:800}
.sum .grid em{font-style:normal;font-weight:800;min-width:28px;text-align:center;padding:0 6px}

/* ---- sections ---- */
h2{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 0 6px;padding:3px 12px;background:#111;color:#fff;border-radius:5px;font-size:13.5px;font-weight:700;line-height:1.5}
h2 .cnt{font-weight:600;font-size:11.5px;white-space:nowrap;background:#fff;color:#111;border-radius:99px;padding:0 10px;line-height:1.55}
section{margin:0 0 6px;padding:0 0 5px;border-bottom:1px dotted #bdbdbd}
.q{margin:0 0 2px;display:flex;gap:9px;font-weight:700;align-items:flex-start}
.n{min-width:21px;height:21px;background:#111;color:#fff;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:none;margin-top:2px}
.qt{padding-top:1px;white-space:pre-line;flex:1 1 auto}
.sx{display:inline-block;box-sizing:border-box;width:.66em;height:.62em;border:1.7px solid currentColor;vertical-align:-.04em;margin:0 .06em}.sx.ci{border-bottom:0;border-radius:.33em .33em 0 0}.sx.cu{border-top:0;border-radius:0 0 .33em .33em}
.mx{display:inline-flex;flex-direction:row;flex-wrap:wrap;gap:0 .28em;align-items:baseline;direction:ltr;unicode-bidi:isolate;white-space:pre}.mx>.mw{display:inline-block}
.fr{display:inline-block;vertical-align:middle;text-align:center;margin:0 3px;line-height:1.2;white-space:nowrap}.fr>span{display:block;padding:0 4px}.fr>.nu{border-bottom:1.4px solid currentColor;padding-bottom:1px}.fr>.de{padding-top:1px}
.rt{display:inline-block;white-space:nowrap;vertical-align:baseline}.rt .rs{display:inline-block;font-size:1.15em;line-height:1;margin-right:-1px}.rt .rd{display:inline-block;border-top:1.4px solid currentColor;padding:1px 2px 0 2px;line-height:1.15}.rt .ri{font-size:.6em;vertical-align:top;margin-right:-4px;position:relative;top:-2px}
sup.pw{font-size:.68em;line-height:0;vertical-align:super}
.eqline{margin:2px 30px 3px 0;text-align:center;font-size:15px;font-weight:600;letter-spacing:.3px}
.c{list-style:none;margin:0;padding:0 30px 0 0;display:flex;flex-wrap:wrap;gap:2px 20px}
.c li{display:flex;gap:6px;align-items:flex-start;flex:0 1 auto}
.l{flex:none;width:19px;height:19px;border:1.4px solid #111;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-top:2px;line-height:1}
.c .t{padding-top:1px}
.c li.ok .l{background:#111;color:#fff}.c li.ok .t{font-weight:800;text-decoration:underline;text-underline-offset:3px}
.tf{display:flex;gap:18px;margin-right:auto;flex:none;padding-top:1px}
.opt{display:inline-flex;align-items:center;gap:7px;font-weight:600}
.bx{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border:1.5px solid #111;border-radius:4px;font-size:12px;font-weight:800;line-height:1}
.opt.on{font-weight:800}.opt.on .bx{background:#111;color:#fff}
.model.sol .sl{white-space:normal;min-height:1.5em}.model.pre{white-space:pre-wrap}.model.eq{font-size:14px}
.ln{border-bottom:1.2px dashed #777;height:21px;margin:0 30px 0 0}
.mt{display:flex;gap:26px;margin:4px 30px 3px 0;align-items:flex-start}.mc{flex:1 1 0;display:flex;flex-direction:column;gap:3px}
.mi{display:flex;align-items:flex-start;gap:7px;padding:2px 8px;border:1px solid #bdbdbd;border-radius:5px;font-size:12.5px;line-height:1.45}
.mi>b{flex:none;min-width:19px;height:19px;border:1.4px solid #111;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-top:1px}
.mi>.mb{flex:none;min-width:28px;height:19px;border-bottom:1.2px solid #111;text-align:center;font-weight:800;font-size:12px;line-height:19px}
.tl{flex:none;align-self:flex-end;width:120px;border-bottom:1.2px dashed #777;height:16px;margin-right:6px}
.bl{display:inline-block;min-width:70px;border-bottom:1.2px solid #111;height:1em;vertical-align:baseline;margin:0 3px}
.model{margin:2px 30px 0 0;padding:4px 10px;background:#f1f1f1;border-right:3px solid #111;border-radius:3px;font-size:12.5px}
.why{margin:3px 30px 0 0;padding:2px 10px;border-right:3px solid #999;font-size:11.5px;color:#333}
/* footer: the teacher's name and phone, at the bottom of every sheet */
#ft{display:none}
.sheet>.foot{display:flex;justify-content:space-between;align-items:center;gap:12px;position:absolute;z-index:1;left:${M_SIDE}mm;right:${M_SIDE}mm;bottom:6mm;padding:3px 2px 0;border-top:1.2px solid #111;font-size:11.5px;color:#222}
.foot b{font-weight:800}
/* a map cut out of the book, printed above its questions */
.mapbox{margin:2px 0 6px;padding:5px;border:1.2px solid #999;border-radius:6px;text-align:center;background:#fff}
.mapbox img{display:inline-block;max-width:100%;max-height:92mm;width:auto;height:auto;object-fit:contain;vertical-align:top}
/* a story question (English): the story in a box, then its questions a, b, c... */
.story{margin:4px 0 6px;margin-inline-start:30px;padding:6px 12px;border:1.5px solid #111;border-radius:6px;background:#f6f6f6;font-size:13px;line-height:1.6;text-align:left}
.story p{margin:0 0 3px}.story p:last-child{margin:0}
.sq{list-style:none;margin:0 0 0;padding:0;margin-inline-start:30px;text-align:left}
.sq li{display:flex;gap:8px;align-items:flex-start;margin:0 0 3px}
.sq li>b{flex:none;width:19px;height:19px;border:1.4px solid #111;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;margin-top:2px;line-height:1}
.sq li>div{flex:1 1 auto;min-width:0}.sq .sqt{display:block;font-weight:600;padding-top:1px}
.sq .ln{margin:0}.sq .model{margin:2px 0 0;border-right:0;border-left:3px solid #111}
.end{margin:10px 0 0;text-align:center;font-size:12px;font-weight:700;color:#333}
.end span{display:inline-block;padding:3px 22px;border-top:1.5px solid #111;border-bottom:1.5px solid #111}
</style></head><body>
<img id="wm" class="wm" src="${WM_DATA_URI}" alt="">
${footer}
<div id="measure">${header}${keyBox}${groupBlocks.join("")}${end}</div>
<div id="out"></div>
<script>${PAGER}</script>
</body></html>`;
  return html;
}

// ---------- 4) build a real PDF file (no browser print dialog) ----------
// We take a picture of every A4 sheet and put the pictures in a PDF of exactly A4 pages: no extra lines, no empty pages,
// and the same result on every browser, computer and phone.
async function waitReady(d: Document) {
  const t0 = Date.now();
  while (d.documentElement.getAttribute("data-ready") !== "1" && Date.now() - t0 < 9000) await new Promise((r) => setTimeout(r, 100));
  try { await (d as any).fonts?.ready; } catch {}
}

// html2canvas draws a word as ONE piece of text only when the browser reports ONE rectangle for it. Some browsers (Safari / phones) report several
// for Arabic words (diacritics, mixed fonts, bidi runs); html2canvas then draws every letter alone and the Arabic joining breaks and overlaps.
// While the sheets are photographed, every word gets the single rectangle that surrounds all its pieces. Returns a function that undoes it.
export function mergeRangeRects(win: Window): () => void {
  const R = (win as any).Range?.prototype;
  if (!R || R.__merged) return () => {};
  const orig = R.getClientRects;
  R.getClientRects = function () {
    const list = orig.call(this);
    if (list.length <= 1) return list;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const x of Array.from(list) as DOMRect[]) {
      if (!x.width) continue;
      l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); b = Math.max(b, x.bottom);
    }
    return l === Infinity ? list : [new (win as any).DOMRect(l, t, r - l, b - t)];
  };
  R.__merged = true;
  return () => { R.getClientRects = orig; delete R.__merged; };
}

async function buildPdf(d: Document): Promise<Blob> {
  // html2canvas draws the text on a canvas that belongs to THIS page (not to the hidden exam frame), so this page needs the
  // Cairo font too - otherwise the letters are drawn in a plain font that does not fit the measured spaces.
  if (!document.getElementById("cairop-fonts")) {
    const st = document.createElement("style"); st.id = "cairop-fonts"; st.textContent = fontCss(location.origin);
    document.head.appendChild(st);
  }
  try {
    const sample = "CenterExam ABC 123";
    await Promise.all([400, 600, 800].map((w) => document.fonts.load(`${w} 14px CairoP`, sample)));
  } catch {}
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const sheets = Array.from(d.querySelectorAll<HTMLElement>(".sheet"));
  if (!sheets.length) throw new Error("no sheets");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const restore = d.defaultView ? mergeRangeRects(d.defaultView) : () => {};
  try {
    for (let i = 0; i < sheets.length; i++) {
      const el = sheets[i];
      const canvas = await html2canvas(el, {
        scale: IS_MOBILE ? 2 : 3, backgroundColor: "#ffffff", useCORS: true, logging: false,
        windowWidth: el.offsetWidth, windowHeight: el.offsetHeight,
      });
      if (i) pdf.addPage("a4", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.93), "JPEG", 0, 0, SHEET_W, SHEET_H);
      canvas.width = canvas.height = 0; // free the memory before the next sheet
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally { restore(); }
  return pdf.output("blob");
}

const clickLink = (url: string, name?: string) => {
  const a = document.createElement("a");
  a.href = url; if (name) a.download = name; else { a.target = "_blank"; a.rel = "noopener"; }
  document.body.appendChild(a); a.click(); a.remove();
};

// A phone does not let a page save a file by itself (nothing happens, or it is silently blocked). The person must TAP a button:
// "Share / Save" opens the phone's own share sheet (Save to Files, WhatsApp, Drive...), "Open" shows the PDF in the viewer.
function showPdfSheet(blob: Blob, name: string, onClose: () => void) {
  const url = URL.createObjectURL(blob);
  const ov = document.createElement("div");
  ov.dir = "rtl";
  ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Cairo,Tahoma,Arial,sans-serif";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;color:#111;border-radius:16px;max-width:380px;width:100%;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,.4);text-align:center";
  const mk = (txt: string, bg: string, fg: string) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = txt;
    b.style.cssText = `display:block;width:100%;margin:8px 0 0;padding:13px;border:0;border-radius:12px;font:inherit;font-weight:800;font-size:16px;background:${bg};color:${fg};cursor:pointer`;
    return b;
  };
  const h = document.createElement("div"); h.textContent = "ملف PDF جاهز ✓"; h.style.cssText = "font-weight:800;font-size:18px";
  const n = document.createElement("div"); n.textContent = name; n.style.cssText = "font-size:12.5px;opacity:.7;margin:4px 0 8px;word-break:break-word";
  const share = mk("مشاركة / حفظ الملف", "#111", "#fff");
  const open = mk("فتح الملف", "#e9e9ee", "#111");
  const close = mk("إغلاق", "transparent", "#555");
  const close_ = () => { ov.remove(); URL.revokeObjectURL(url); onClose(); };
  share.onclick = async () => {
    try {
      const file = new File([blob], name, { type: "application/pdf" });
      const nav = navigator as any;
      if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: name }); return; }
    } catch (err: any) { if (err?.name === "AbortError") return; } // the person closed the share sheet
    clickLink(url, name);
  };
  open.onclick = () => clickLink(url);
  close.onclick = close_;
  box.append(h, n, share, open, close); ov.append(box); document.body.appendChild(ov);
}

// Phone -> a sheet with "Share / Save" is shown ("sheet"). Computer -> the PDF file is downloaded straight away ("saved").
// Throws if the file could not be made (there is no print-dialog fallback any more).
export async function exportExam(e: Exam, v: string, key = false, teacher?: Teacher | null): Promise<"sheet" | "saved"> {
  const html = examHtml(e, v, key, teacher);
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0";
  document.body.appendChild(f);
  try {
    const d = f.contentDocument!;
    d.open(); d.write(html); d.close();
    await waitReady(d);
    const name = `${e.title} - ${v} - ${key ? "مع الحل" : "بدون حل"}`.replace(/[\\/:*?"<>|]+/g, " ").trim() + ".pdf";
    const blob = await buildPdf(d);
    if (IS_MOBILE) { showPdfSheet(blob, name, () => {}); return "sheet"; }
    const url = URL.createObjectURL(blob);
    clickLink(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "saved";
  } finally { f.remove(); }
}
