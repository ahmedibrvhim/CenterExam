// Reads the chosen pages (locally, no AI request) and finds the sentences each question type can be built from:
//   عرّف / اكتب المصطلح  <- definitions and named terms ("يُسمّى", "هو", "يُعرَّف")
//   قارن                 <- comparisons ("الفرق بين", "بينما", "يختلف", "على عكس")
//   علّل                 <- cause and effect ("لأن", "بسبب", "لذلك", "مما يؤدي")
//   معادلات              <- chemical equations
//   اختر / صح وخطأ / أكمل <- plain facts (any sentence that states something)
//   صل / رتّب            <- word lists, term -> meaning pairs, dated events, short sentences that can be scrambled
//   أعرب / استخرج / بلاغة  <- grammar, morphology and rhetoric sentences (Arabic)
//   اذكر / عدّد           <- enumerations (causes, results, features)
//   correct / rewrite    <- English sentences and grammar points
// Every subject reads the same pages with the same engine; only the evidence it asks for differs (see evidenceFor).
// The result tells the teacher which types the pages can support, and how many of each one copy of the exam should have.
// The same sentences are also given to the AI as "key sentences", so the questions come from the best material of the pages.
import type { Avail, Kind } from "@/lib/subjects";

export const norm = (s: string) =>
  s.normalize("NFKC").replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

export type Signals = {
  facts: number;          // sentences that state a fact
  define: string[];       // "X هو ..." / "يُعرَّف ..." / "يُقصد بـ ..."
  term: string[];         // "... يُسمّى X" / "يُطلق عليه X"
  compare: string[];
  reason: string[];
  equations: string[];
  problems: string[];     // "احسب / أوجد ..." with numbers and units
  laws: string[];         // formulas such as "V = I × R"
  math: string[];         // math exercises / examples / worked lines (used by the math subject)
  gram: string[];         // Arabic grammar / morphology statements (مبتدأ، فاعل، منصوب، جمع تكسير ...)
  rhet: string[];         // Arabic rhetoric statements (تشبيه، استعارة، كناية، طباق ...)
  glossary: string[];     // "word : meaning" lines and synonym / antonym / plural cues (vocabulary, matching)
  dates: string[];        // sentences that carry a year / date (history: ordering events)
  lists: string[];        // enumerations: "... : a, b, c" / أولًا ... ثانيًا ... / bullet lines
  short: string[];        // short complete sentences (4-10 words): can be scrambled for "put in order"
  en: number;             // number of English sentences (the English subject needs them)
  enGram: string[];       // English sentences that show a grammar point (tenses, passive, conditionals, comparatives ...)
};

// A heading is not a sentence. Lines of one paragraph are joined, then cut at . ? ! ؟
export function splitSentences(text: string): string[] {
  const paras: string[] = [];
  let buf = "";
  const flush = () => { if (buf) { paras.push(buf); buf = ""; } };
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l) { flush(); continue; }
    if (l.length < 28 && !/[.؟?!:،,؛;]$/.test(l)) { flush(); continue; } // short line without punctuation = heading
    buf += (buf ? " " : "") + l;
  }
  flush();
  const out: string[] = [];
  for (const p of paras) for (const m of p.match(/[^.؟?!]+[.؟?!]?/g) ?? []) { const t = m.trim(); if (t.length >= 25 && t.length <= 320) out.push(t); }
  return out;
}

// patterns run on the normalised sentence (no diacritics, أ/إ/آ -> ا, ى -> ي, ة -> ه)
const DEF = /^(?:\S+\s+){1,7}?(?:هو|هي|هم|يعد|تعد|يعتبر|تعتبر|يمثل|تمثل|عباره عن|يقصد به|تقصد به)\s+\S/;
const DEF_WORD = /(?:يعرف|تعرف|نعرف|يقصد ب|المقصود ب|تعريف)/;
const TERM = /(?:يسمي|تسمي|يسمون|سمي|سميت|يطلق عليه|يطلق عليها|تطلق عليه|تطلق عليها|يعرف باسم|تعرف باسم|ما يسمي|ما يعرف ب|المصطلح)/;
const COMPARE = /(?:الفرق بين|يختلف|تختلف|اختلاف|مقارنه|قارن|بينما|في حين|علي عكس|بعكس|يتشابه|تتشابه|تشابه|وجه الشبه|اوجه الشبه|وجه الاختلاف|اوجه الاختلاف|اما\s+\S+(?:\s+\S+){0,5}\s+ف)/;
const REASON = /(?:لان|لانه|لانها|بسبب|نتيجه ل|ولذلك|لذلك|مما يؤدي|مما يجعل|مما يسبب|يرجع ذلك|يعود ذلك|حيث ان|ينتج عن|يؤدي الي|نظرا ل|تبعا ل|علل)/;

// chemical equations: formulas (with coefficients / subscripts) joined by "+" and an arrow, e.g. "2H₂ + O₂ → 2H₂O"
const FORM = "\\d*[A-Z][A-Za-z0-9₀-₉()\\[\\]]*[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]*(?:\\((?:g|s|l|aq)\\))?[↑↓]?"; // ions (Na⁺) and gas/precipitate arrows (CO₂↑) allowed
const SIDE = `${FORM}(?:\\s*\\+\\s*${FORM})*`;
const EQ = new RegExp(`${SIDE}\\s*(?:[-–—─━⎯ـ]*[→⟶⟹⇒⇌⇄⇆⟵←➝➔➜]|[-–—─━⎯ـ]{1,}>)\\s*${SIDE}`, "g");

// numeric problems: a calculation verb with numbers, or several quantities with science units
const CALC = /(?:احسب|اوجد|ما قيمه|ما مقدار|كم يبلغ|مساله|مسايل|تمرين|مثال)/;
const NUM = "[0-9٠-٩]+(?:[.,٫][0-9٠-٩]+)?";
const UNIT = new RegExp(`${NUM}\\s*(?:فولت|امبير|اوم|نيوتن|جول|واط|كيلو\\S*|كجم|جم|مول|لتر|متر|سم|مم|ثانيه|دقيقه|ساعه|هرتز|درجه|°|م/ث|كم/س|v\\b|a\\b|n\\b|j\\b|w\\b|kg|g\\b|cm|mm|m\\b|s\\b|mol|hz|ohm|Ω)`, "gi");
const HASNUM = /[0-9٠-٩]/;
// a law written as a formula on its own line: "V = I × R", "شدة التيار = كمية الكهربية ÷ الزمن"
const isLaw = (l: string) => l.length >= 5 && l.length <= 90 && l.includes("=") && !/[→⟶⇌⇄←⟵]|[-–—─━⎯ـ]>/.test(l) && (/[×÷*\/]/.test(l) || /^\s*[A-Za-z]{1,3}\s*=/.test(l)) && !/^[\d\s.=+\-]+$/.test(l);

// MATH: exercises and examples are short lines such as "احسب: ٣٤ + ٥٦" or "أوجد قيمة س: ٢س + ٣ = ١١", so they are read line by line
// (the sentence splitter above drops anything shorter than 25 letters).
const MATH_VERB = /(?:احسب|اوجد|جد|حل|بسط|اختصر|اكمل|ما ناتج|ما قيمه|ما مقدار|ما هو|ما هي|قارن|رتب|مثل|حلل|اثبت|كم|اي مما ياتي|اختر)/;
const MATH_OP = /[=+\-−×÷*\/^√%<>≤≥≠²³]/;
export function mathItems(text: string): string[] {
  const out: string[] = [], seen = new Set<string>();
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (l.length < 6 || l.length > 260 || !HASNUM.test(l)) continue;
    const n = norm(l);
    if (!(MATH_VERB.test(n) || (MATH_OP.test(l) && (l.match(/[0-9٠-٩]/g) ?? []).length >= 2))) continue;
    const key = n.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key); out.push(l);
  }
  return out;
}

const clip = (s: string, n = 190) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---- language subjects (patterns run on the normalised sentence) ----
const GRAM_AR = /(?:مبتدا|خبر كان|خبر ان|الخبر|فاعل|مفعول|نايب فاعل|نعت|مضاف اليه|جار ومجرور|مرفوع|منصوب|مجرور|مجزوم|اعراب|كان واخواتها|ان واخواتها|تمييز|معطوف|توكيد|استثناء|منادي|فعل ماضي|فعل مضارع|فعل امر|اسم فاعل|اسم مفعول|جمله اسميه|جمله فعليه|مبني|معرب|علامه (?:الرفع|النصب|الجر|الجزم)|الاسم المنقوص|الاسم المقصور|الممدود|المثني|جمع المذكر السالم|جمع المؤنث السالم|جمع التكسير|الفعل المعتل|الفعل الصحيح|الفعل المجرد|الفعل المزيد|اسم المره|اسم الهيئه|الممنوع من الصرف)/;
const RHET_AR = /(?:تشبيه|استعاره|كنايه|طباق|مقابله|جناس|سجع|محسن بديعي|المحسنات|مشبه|وجه الشبه|اداه التشبيه|صوره بيانيه|الصوره الفنيه|اسلوب (?:خبري|انشايي|قصر|شرط|تعجب|نداء|استفهام|امر|نهي|توكيد)|بلاغ)/;
const VOCAB_CUE = /(?:مرادف|ضد |عكس |مفرد |جمع |معني كلمه|معاني الكلمات|المفردات|ثروه لغويه|اثري لغتك|synonym|opposite|antonym|plural|singular|vocabulary|word bank|word list)/i;
const GLOSS_LINE = /^[^\s:：\-–—]{2,16}(?:\s[^\s:：\-–—]{1,12})?\s*[:：\-–—]\s*\S.{2,60}$/;
const NOT_GLOSS = /^(?:الدرس|الوحده|الفصل|الباب|الموضوع|درس|وحده|unit|lesson|chapter|page|الصفحه|(?:في|من|علي|الي|عن|مثل|قال|يقول|نحو|اي|كما|ثم|ان|لان|حيث|اذا)\s)/i;
const DATE_RE = /(?:^|[^0-9.,])(?:(?:1[0-9]{3}|20[0-2][0-9])\s*(?:ق\s*\.?\s*م|م|ه|ميلادي|هجري)(?![\u0621-\u064A])|[1-9][0-9]{2,3}\s*(?:ق\s*\.?\s*م|ميلادي|هجري)(?![\u0621-\u064A])|(?:1[0-9]{3}|20[0-2][0-9])(?![0-9.,]|\s*(?:نسمه|كم|متر|كيلو|جنيه|طن|فدان|مليون|مليار|الف|سم|دولار|%|٪)))/;
const ENUM_COLON = /[:：]\s*[^،,:]{2,45}(?:[،,]\s*[^،,:]{2,45}){2,}/;
const ORDINALS = /(?:اولا|ثانيا|ثالثا|رابعا)/g;
const BULLET = /^\s*(?:[-•●▪◦*]|\d{1,2}\s*[-.)]|[٠-٩]{1,2}\s*[-.)])\s*\S/;
const EN_GRAM = /\b(?:present|past|future)\s+(?:simple|continuous|perfect|progressive)\b|\bpassive\b|\breported speech\b|\bconditional\b|\bif\s+\w+.*\b(?:will|would)\b|\b(?:more|less)\s+\w+\s+than\b|\b\w+er\s+than\b|\bthe\s+(?:most|least)\s+\w+|\b(?:is|are|was|were|am|been|be|being)\s+\w+(?:ed|en)\b|\bused to\b|\b(?:has|have|had)\s+\w+(?:ed|en)\b|\b(?:who|which|whose)\b|\b(?:must|should|could|might|have to)\s+\w+/i;
const toEnDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
const latinRatio = (s: string) => { const lat = (s.match(/[A-Za-z]/g) ?? []).length, all = (s.match(/[A-Za-z\u0621-\u064A]/g) ?? []).length; return all ? lat / all : 0; };

export function extractSignals(text: string): Signals {
  const sig: Signals = { facts: 0, define: [], term: [], compare: [], reason: [], equations: [], problems: [], laws: [], math: [], gram: [], rhet: [], glossary: [], dates: [], lists: [], short: [], en: 0, enGram: [] };
  const seen = new Set<string>();
  for (const s of splitSentences(text)) {
    const n = norm(s);
    if (HASNUM.test(n) && ((CALC.test(n)) || (n.match(UNIT) ?? []).length >= 2)) sig.problems.push(clip(s)); // problems are often written as questions: check before the question filter
    if (/[؟?]\s*$/.test(s) || s.length < 30) continue;       // a question is not a fact
    const key = n.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    sig.facts++;
    const isTerm = TERM.test(n);
    if (isTerm) sig.term.push(clip(s));
    if (!isTerm && (DEF.test(n) || DEF_WORD.test(n))) sig.define.push(clip(s));
    if (COMPARE.test(n)) sig.compare.push(clip(s));
    if (REASON.test(n)) sig.reason.push(clip(s));
    // ---- language / social studies material ----
    const words = s.trim().split(/\s+/).length;
    if (latinRatio(s) >= 0.7) {
      sig.en++;
      if (EN_GRAM.test(s)) sig.enGram.push(clip(s));
    } else {
      if (GRAM_AR.test(n)) sig.gram.push(clip(s));
      if (RHET_AR.test(n)) sig.rhet.push(clip(s));
      if (DATE_RE.test(toEnDigits(n))) sig.dates.push(clip(s));
    }
    if (ENUM_COLON.test(s) || (n.match(ORDINALS) ?? []).length >= 2) sig.lists.push(clip(s));
    if (words >= 4 && words <= 10 && !HASNUM.test(s) && sig.short.length < 200) sig.short.push(clip(s, 120));
  }
  const laws = new Set<string>();
  for (const l of text.split("\n")) if (isLaw(l)) laws.add(clip(l.replace(/\s+/g, " ").trim(), 120));
  sig.laws = [...laws];
  sig.math = mathItems(text);
  // glossary lines ("word : meaning") and vocabulary cues, read line by line (they are shorter than a sentence)
  const gl = new Set<string>();
  let run: string[] = [];
  const endRun = () => { if (run.length >= 3) sig.lists.push(clip(run[0] + " …")); run = []; };
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (BULLET.test(l)) run.push(l); else endRun();
    if (l.length < 6 || l.length > 80) continue;
    const ln = norm(l);
    if ((GLOSS_LINE.test(l) && !NOT_GLOSS.test(ln) && !/[.؟?!]$/.test(l)) || VOCAB_CUE.test(ln)) gl.add(clip(l, 90));
    if (gl.size >= 120) break;
  }
  endRun();
  sig.glossary = [...gl];
  const eq = new Set<string>();
  for (const m of text.matchAll(EQ)) {
    const e = m[0].replace(/\s+/g, " ").trim();
    if (e.includes("+") || /[a-z0-9₀-₉]/.test(e.replace(/\s/g, "").replace(/→.*/, ""))) eq.add(e); // "A → B" alone is probably a diagram, not a reaction
  }
  sig.equations = [...eq];
  return sig;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Reading age of an English text from how long its sentences and words are (used when the book does not say its grade).
// Egyptian school English is simple: the age is only a rough guide for the length / difficulty of a story.
export function englishReadingAge(text: string): number | null {
  const sents = (text.match(/[A-Za-z][^.!?\n]{8,200}[.!?]/g) ?? []).filter((x) => /^[\x00-\x7F\s]+$/.test(x));
  if (sents.length < 8) return null;
  const words = sents.flatMap((x) => x.match(/[A-Za-z']+/g) ?? []);
  if (words.length < 60) return null;
  const perSentence = words.length / sents.length, wordLen = words.reduce((n, w) => n + w.length, 0) / words.length;
  const score = perSentence + 3 * (wordLen - 4);
  return score < 6 ? 7 : score < 8 ? 9 : score < 10 ? 11 : score < 13 ? 13 : 15;
}

type Item = { k: Kind; n: number; ok: boolean; why: string; w: number; cap: number };
// size of one copy: grows with the pages, but never more than the text can support. Each type gets a share by its weight, never more than its material.
function plan(items: Item[], total: number): Avail {
  const sumW = items.filter((i) => i.ok).reduce((n, i) => n + i.w, 0) || 1;
  const out: Avail = {};
  for (const i of items) out[i.k] = { ok: i.ok, n: i.n, suggest: i.ok ? clamp(Math.round((total * i.w) / sumW), 1, Math.max(1, i.cap)) : 0, why: i.ok ? undefined : i.why };
  return out;
}

// Which question types do these pages support, and how many of each would a balanced copy of the exam have?
export function evidenceFor(sig: Signals, pages: number, subject?: string): Avail {
  const S = sig.facts, D = sig.define.length, T = sig.term.length, C = sig.compare.length, R = sig.reason.length, E = sig.equations.length, P = sig.problems.length, L = sig.laws.length;
  const G = sig.gram.length, H = sig.rhet.length, V = sig.glossary.length, DT = sig.dates.length, LS = sig.lists.length, SH = sig.short.length, EN = sig.en, EG = sig.enGram.length;
  const tooShort = "الصفحات المحددة قصيرة لا تكفي لأسئلة";
  const tooShortEn = "لا يوجد نص إنجليزي كافٍ في الصفحات المحددة";
  const noReason = "لم تُرصد عبارات تعليل (لأن / بسبب / لذلك…) في الصفحات المحددة";
  const noTerm = "لم تُرصد مصطلحات أو تعريفات كافية في الصفحات المحددة";
  const noDefine = "لم تُرصد تعريفات في الصفحات المحددة";
  const noCompare = "لم تُرصد مقارنات (الفرق بين / بينما / يختلف…) في الصفحات المحددة";
  const noPairs = "لم تُرصد أزواج كافية (كلمة ومعناها / مصطلح وتعريفه / حدث وتاريخه) في الصفحات المحددة";
  const noShort = "لم تُرصد جمل قصيرة كاملة يمكن تبعثرها وإعادة ترتيبها";
  const total = (n: number) => clamp(Math.round(Math.min(pages * 1.6, n * 0.5)), 6, 36);
  const pairs = V + T + D + DT;

  if (subject === "math") {
    // math pages are mostly numbers and short lines, so the evidence is the exercises/examples + the explanation sentences
    const M = sig.math.length + L, mat = M + S;
    const okM = mat >= 4, whyM = "الصفحات المحددة لا تحتوي مادة كافية (تمارين / أمثلة / قواعد) لهذا النوع";
    const totalM = clamp(Math.round(Math.min(pages * 1.6, mat * 0.7)), 4, 30);
    const mcqN = clamp(Math.round(totalM * 0.35), 1, 12), fillN = clamp(Math.round(totalM * 0.25), 1, 8), solveN = clamp(totalM - mcqN - fillN, 1, 20);
    return {
      mcq: { ok: okM, n: mat, suggest: okM ? mcqN : 0, why: okM ? undefined : whyM },
      fill: { ok: okM, n: mat, suggest: okM ? fillN : 0, why: okM ? undefined : whyM },
      solve: { ok: okM, n: mat, suggest: okM ? solveN : 0, why: okM ? undefined : whyM },
    };
  }

  if (subject === "arabic") {
    const okS = S >= 6;
    return plan([
      { k: "mcq", n: S, ok: okS, why: tooShort, w: 4, cap: S },
      { k: "tf", n: S, ok: okS, why: tooShort, w: 3, cap: S },
      { k: "fill", n: S, ok: okS, why: tooShort, w: 3, cap: S },
      { k: "match", n: pairs, ok: pairs >= 4, why: noPairs, w: 1.5, cap: Math.floor(pairs / 4) },
      { k: "order", n: SH, ok: SH >= 3, why: noShort, w: 1.5, cap: SH },
      { k: "vocab", n: V + Math.floor(S / 4), ok: V >= 3 || S >= 8, why: "لم تُرصد مفردات أو معانٍ كافية في الصفحات المحددة", w: V >= 3 ? 2.5 : 1.5, cap: V + Math.floor(S / 4) },
      { k: "reason", n: R, ok: R >= 2, why: noReason, w: 2, cap: R },
      { k: "essay", n: S, ok: okS, why: tooShort, w: 2, cap: Math.ceil(S * 0.3) },
      { k: "irab", n: G, ok: G >= 3, why: "لم تُرصد قواعد نحو أو أمثلة إعراب في الصفحات المحددة", w: 2.5, cap: G },
      { k: "extract", n: G + H + V, ok: G + H + V >= 3, why: "لم تُرصد مادة نحو أو بلاغة أو مفردات يُستخرج منها في الصفحات المحددة", w: 1.5, cap: G + H },
      { k: "rhetoric", n: H, ok: H >= 2, why: "لم تُرصد مادة بلاغة (تشبيه / استعارة / كناية…) في الصفحات المحددة", w: 1.5, cap: H },
    ], total(S));
  }

  if (subject === "social") {
    const okS = S >= 6;
    return plan([
      { k: "mcq", n: S, ok: okS, why: tooShort, w: 4, cap: S },
      { k: "tf", n: S, ok: okS, why: tooShort, w: 3, cap: S },
      { k: "fill", n: S, ok: okS, why: tooShort, w: 3, cap: S },
      { k: "match", n: pairs, ok: pairs >= 4, why: noPairs, w: 1.5, cap: Math.floor(pairs / 4) },
      { k: "order", n: DT, ok: DT >= 3, why: "لم تُرصد أحداث بتواريخ كافية لترتيبها زمنيًا في الصفحات المحددة", w: 1.5, cap: Math.floor(DT / 3) },
      { k: "term", n: T + D, ok: T + D >= 3, why: noTerm, w: 2, cap: Math.ceil((T + D) * 0.6) },
      { k: "define", n: T + D, ok: T + D >= 2, why: noDefine, w: 2, cap: T + D },
      { k: "reason", n: R, ok: R >= 2, why: noReason, w: 2.5, cap: R },
      { k: "compare", n: C, ok: C >= 2, why: noCompare, w: 1.5, cap: C },
      { k: "list", n: LS + R, ok: LS >= 2 || R >= 3, why: "لم تُرصد قوائم أو أسباب ونتائج يمكن عدّها في الصفحات المحددة", w: 2, cap: LS + R },
      // the maps are found in the PICTURES of the pages (lib/maps.ts), not in the text: the page overrides this entry once it has searched them
      { k: "map", n: 0, ok: false, why: "لم يُعثر على خرائط في الصفحات المحددة", w: 2, cap: 1 },
    ], total(S));
  }

  if (subject === "english") {
    const okE = EN >= 6;
    return plan([
      { k: "mcq", n: EN, ok: okE, why: tooShortEn, w: 4, cap: EN },
      { k: "tf", n: EN, ok: okE, why: tooShortEn, w: 2.5, cap: EN },
      { k: "fill", n: EN, ok: okE, why: tooShortEn, w: 3, cap: EN },
      { k: "match", n: V, ok: V >= 4, why: "لم تُرصد قوائم كلمات ومعانيها في الصفحات المحددة", w: 1.5, cap: Math.floor(V / 4) },
      { k: "order", n: SH, ok: okE && SH >= 3, why: noShort, w: 1.5, cap: SH },
      { k: "vocab", n: V + Math.floor(EN / 4), ok: okE && (V >= 3 || EN >= 10), why: "لم تُرصد مفردات كافية في الصفحات المحددة", w: V >= 3 ? 2.5 : 1.5, cap: V + Math.floor(EN / 4) },
      { k: "essay", n: EN, ok: okE, why: tooShortEn, w: 2, cap: Math.ceil(EN * 0.3) },
      { k: "story", n: EN, ok: okE, why: tooShortEn, w: 1.2, cap: 2 },
      { k: "correct", n: EN, ok: okE, why: tooShortEn, w: EG >= 3 ? 2.5 : 1.5, cap: Math.ceil(EN * 0.4) },
      { k: "rewrite", n: EN, ok: okE, why: tooShortEn, w: EG >= 3 ? 2.5 : 1.5, cap: Math.ceil(EN * 0.4) },
    ], total(EN));
  }

  // science (the default)
  return plan([
    { k: "mcq", n: S, ok: S >= 6, why: tooShort, w: 4, cap: S },
    { k: "tf", n: S, ok: S >= 6, why: tooShort, w: 3, cap: S },
    { k: "fill", n: S, ok: S >= 6, why: tooShort, w: 3, cap: S },
    { k: "reason", n: R, ok: R >= 2, why: noReason, w: 2, cap: R },
    { k: "term", n: T + D, ok: T + D >= 3, why: noTerm, w: 2, cap: Math.ceil((T + D) * 0.6) },
    { k: "define", n: T + D, ok: T + D >= 2, why: noDefine, w: 2, cap: T + D },
    { k: "compare", n: C, ok: C >= 2, why: noCompare, w: 1.5, cap: C },
    { k: "balance", n: E, ok: E >= 1, why: "لم تُرصد معادلات كيميائية في الصفحات المحددة", w: 2, cap: E },
    { k: "write", n: E, ok: E >= 1, why: "لم تُرصد معادلات كيميائية في الصفحات المحددة", w: 2, cap: E },
    { k: "problem", n: P + L, ok: L >= 1 || P >= 2, why: "لم تُرصد قوانين أو مسائل حسابية (احسب / أوجد / وحدات) في الصفحات المحددة", w: 2, cap: P + L },
  ], total(S));
}

// What the pages mostly teach, in the teacher's words (shown as tags after the analysis, and given to the AI so it writes the right mix of questions).
export function focusFor(sig: Signals, subject?: string): string[] {
  const out: string[] = [];
  const S = sig.facts, T = sig.term.length + sig.define.length, V = sig.glossary.length;
  if (subject === "arabic") {
    if (sig.gram.length >= 3) out.push("نحو وصرف");
    if (sig.rhet.length >= 2) out.push("بلاغة");
    if (V >= 3) out.push("مفردات");
    if (S >= 8 && sig.gram.length + sig.rhet.length < S * 0.5) out.push("نصوص وفهم");
  } else if (subject === "social") {
    if (sig.dates.length >= 3) out.push("تواريخ وأحداث");
    if (T >= 3) out.push("مفاهيم ومصطلحات");
    if (sig.reason.length >= 3) out.push("أسباب ونتائج");
    if (sig.compare.length >= 2) out.push("مقارنات");
    if (sig.lists.length >= 2) out.push("قوائم وعناصر");
  } else if (subject === "english") {
    if (sig.enGram.length >= 4) out.push("Grammar");
    if (V >= 3) out.push("Vocabulary");
    if (sig.en >= 8 && sig.enGram.length < sig.en * 0.6) out.push("Reading");
  }
  return out.slice(0, 4);
}

// Key sentences for the AI, only for the types it is asked to write in this batch.
export function hintsFor(text: string, kinds: string[], subject?: string): string {
  const sig = extractSignals(text);
  const parts: string[] = [];
  const has = (...k: string[]) => k.some((x) => kinds.includes(x));
  const list = (title: string, arr: string[], max: number) => { if (arr.length) parts.push(`${title}\n${arr.slice(0, max).map((x) => `- ${x}`).join("\n")}`); };
  if (has("term", "define")) list("DEFINITIONS / NAMED TERMS stated in the text (best material for term and define questions):", [...sig.term, ...sig.define], 8);
  if (has("compare")) list("COMPARISONS stated in the text (best material for compare questions):", sig.compare, 5);
  if (has("reason")) list("CAUSE-AND-EFFECT statements in the text (best material for reason questions):", sig.reason, 6);
  if (has("balance", "write")) list("CHEMICAL EQUATIONS in the text:", sig.equations, 6);
  if (has("problem")) list("LAWS (formulas) and CALCULATION EXAMPLES in the text (best material for problem questions; use these laws and similar numbers):", [...sig.laws, ...sig.problems], 8);
  if (subject === "math") list("MATH EXERCISES, EXAMPLES and RULES in the text (copy their style, topics and difficulty; use NEW numbers):", [...sig.laws, ...sig.math], 10);
  if (has("irab", "extract")) list("GRAMMAR / MORPHOLOGY statements in the text (use exactly these rules and their examples for irab and extract questions):", sig.gram, 8);
  if (has("rhetoric", "extract")) list("RHETORIC statements in the text (use exactly these figures of speech and their examples):", sig.rhet, 6);
  if (has("vocab", "match")) list("WORD LISTS / GLOSSARY lines in the text (word : meaning, synonym, opposite, plural; best material for vocab and match questions):", sig.glossary, 12);
  if (has("match") && !has("term", "define")) list("TERM -> MEANING pairs stated in the text (usable as match pairs):", [...sig.term, ...sig.define], 6);
  if (has("order", "mcq", "fill") && subject === "social") list("EVENTS WITH DATES in the text (order questions: choose 3-5 of them and ask for the chronological order; copy dates exactly):", sig.dates, 8);
  if (has("order") && subject !== "social") list("SHORT SENTENCES of the text that can be scrambled for order questions (scramble the words; the answer is the original sentence):", sig.short, 8);
  if (has("list")) list("ENUMERATIONS in the text (causes, results, features, examples; best material for list questions):", sig.lists, 6);
  if (has("story")) list("VOCABULARY and GRAMMAR points of the text (the story must use these words and these structures):", [...sig.glossary, ...sig.enGram], 12);
  if (has("correct", "rewrite")) list("GRAMMAR POINTS shown by the English sentences of the text (build correct / rewrite questions on exactly these points):", sig.enGram, 8);
  return parts.length ? `KEY SENTENCES found in the text (build the matching question types from these first; they are real statements of the book):\n${parts.join("\n")}\n` : "";
}
