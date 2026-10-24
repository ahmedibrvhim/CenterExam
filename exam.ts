export type Q = { text: string; choices: string[]; kind: "mcq" | "tf" | "essay"; answer?: string; explanation?: string };
export type Exam = {
  id: string; title: string; sources: string[]; questions: Q[];
  versions: string[]; seed: number; shuffleQ: boolean; shuffleA: boolean; date: string;
  createdAt: number; info?: string;
};

// ---------- 1) read text from a PDF (in the browser), one string per page ----------
export async function extractPages(file: File): Promise<string[]> {
  // @ts-ignore - pdfjs-dist 3.x ships without usable types for this path
  const pdfjs: any = await import("pdfjs-dist/build/pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const items = (await (await doc.getPage(p)).getTextContent()).items as any[];
    const lines: string[] = [];
    let y: number | null = null, line = "";
    for (const it of items) {
      const ny = it.transform[5];
      if (y !== null && Math.abs(ny - y) > 3) { lines.push(line); line = ""; }
      line += it.str; y = ny;
    }
    lines.push(line);
    pages.push(lines.join("\n"));
  }
  return pages;
}

// ---------- 1b) split pages into chunks, and pick the chunks the user cares about ----------
export type Chunk = { page: number; text: string };

export function chunkPages(pages: string[], from = 1, to = pages.length, size = 2800): Chunk[] {
  const out: Chunk[] = [];
  let buf = "", start = 1;
  const flush = () => { if (buf.replace(/\s/g, "").length > 120) out.push({ page: start, text: buf.trim() }); buf = ""; };
  for (let p = Math.max(1, from); p <= Math.min(pages.length, to); p++) {
    for (const line of pages[p - 1].split("\n")) {
      if (!buf) start = p;
      buf += line + "\n";
      if (buf.length >= size) flush();
    }
  }
  flush();
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

// ---------- 2) find numbered questions and their choices ----------
const Q_RE = /^\s*(?:س\s*)?[\(\[]?([0-9٠-٩]{1,3})[\)\]]?\s*[\.\-:)،]\s*(.+)/;
const C_RE = /^\s*[\(\[]?([A-Fa-fأإابتثجحخد])[\)\]]?\s*[\.\)\-:]\s*(.+)/;
const TF_RE = /صح\s*(أو|او)?\s*خطأ|true\s*(or|\/)?\s*false/i;

export function parseQuestions(text: string): Q[] {
  const out: Q[] = [];
  let cur: Q | null = null, last: "q" | "c" = "q";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const c = cur ? line.match(C_RE) : null;
    const q = line.match(Q_RE);
    if (c && cur) { cur.choices.push(c[2].trim()); last = "c"; }
    else if (q) { cur = { text: q[2].trim(), choices: [], kind: "essay" }; out.push(cur); last = "q"; }
    else if (cur) {
      if (last === "c") cur.choices[cur.choices.length - 1] += " " + line;
      else cur.text += " " + line;
    }
  }
  for (const x of out) x.kind = x.choices.length >= 2 ? "mcq" : TF_RE.test(x.text) ? "tf" : "essay";
  return out;
}

// ---------- 3) versions (same seed => same version every time) ----------
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

// ---------- 4) PDF: open the print dialog -> "Save as PDF" ----------
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const AR = ["أ", "ب", "ج", "د", "هـ", "و"], EN = ["A", "B", "C", "D", "E", "F"];

// Builds the printable page. key=false -> student copy (no answers). key=true -> same questions with the correct answers marked.
export function examHtml(e: Exam, v: string, key = false): string {
  const qs = buildVersion(e, e.versions.indexOf(v));
  const body = qs.map((q, i) => {
    const ar = /[\u0600-\u06FF]/.test(q.text);
    const L = ar ? AR : EN;
    const tfAns = q.answer === "true" ? (ar ? "صح" : "True") : q.answer === "false" ? (ar ? "خطأ" : "False") : "";
    let extra = "";
    if (q.kind === "mcq") {
      extra = `<ol class="c">${q.choices.map((c, k) => `<li${key && c === q.answer ? ' class="ok"' : ""}><b>${L[k] ?? k + 1})</b> ${esc(c)}${key && c === q.answer ? " ✓" : ""}</li>`).join("")}</ol>`;
    } else if (q.kind === "tf") {
      extra = key && tfAns ? `<p class="tf ok">✓ ${tfAns}</p>`
        : `<p class="tf">( &nbsp; ) ${ar ? "صح" : "True"} &nbsp;&nbsp;&nbsp; ( &nbsp; ) ${ar ? "خطأ" : "False"}</p>`;
    } else {
      extra = key && q.answer ? `<p class="tf ok">✓ ${esc(q.answer)}</p>` : `<div class="ln"></div><div class="ln"></div><div class="ln"></div>`;
    }
    const why = key && q.explanation ? `<p class="why">${esc(q.explanation)}</p>` : "";
    return `<section dir="auto"><p class="q"><b>${i + 1}.</b> ${esc(q.text)}</p>${extra}${why}</section>`;
  }).join("");
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(e.title)} - ${v} - ${key ? "مع الحل" : "بدون حل"}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;800&display=swap" rel="stylesheet">
<style>@page{size:A4;margin:14mm}body{font-family:Cairo,sans-serif;color:#000;font-size:14px;line-height:1.7}
h1{font-size:22px;margin:0}.top{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:8px}
.ver{border:2px solid #000;border-radius:8px;padding:2px 14px;font-weight:800;font-size:20px}
.info{display:flex;justify-content:space-between;margin:12px 0 18px}section{break-inside:avoid;margin-bottom:14px}
.q{margin:0 0 4px}.c{list-style:none;margin:0;padding:0 18px;display:grid;grid-template-columns:1fr 1fr;gap:2px 20px}
.ln{border-bottom:1px solid #777;height:26px}.tf{margin:0 18px}.ok{font-weight:800}.why{margin:2px 18px 0;color:#555;font-size:12px}</style></head><body>
<div class="top"><h1>${esc(e.title)}</h1><span class="ver">${v}${key ? " · مفتاح الإجابة" : ""}</span></div>
${key ? "" : `<div class="info"><span>الاسم: ____________________</span><span>الفصل: ____________</span><span>الدرجة: ______ / ${qs.length}</span></div>`}
${body}</body></html>`;
  return html;
}

export function printExam(e: Exam, v: string, key = false) {
  const html = examHtml(e, v, key);
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open(); d.write(html); d.close();
  setTimeout(async () => {
    await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    f.contentWindow!.focus(); f.contentWindow!.print();
    setTimeout(() => f.remove(), 60000);
  }, 800);
}
