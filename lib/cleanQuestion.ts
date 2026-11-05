// Checks one question written by the AI. Anything that is incomplete, refers to a book / picture the student does not have,
// gives its answer away, or has a wrong / ambiguous answer is dropped: better no question than a broken one.
import type { Q } from "@/exam";
import { balanceCheck } from "@/lib/chem";
import { norm } from "@/lib/analyze";

export type Raw = { type?: string; text?: string; choices?: unknown; answer?: string; explanation?: string };

const LETTERS_N = (t: string) => (t.match(/\p{L}/gu) ?? []).length;

// A question that is too short, or ends in the middle of a sentence ("... في" / "... من"), is dropped.
const DANGLING = /(?:^|\s)(?:في|من|إلى|الى|على|عن|مع|و|أو|او|ثم|التي|الذي|الذين|هل|ما|ماذا|كيف|لماذا|and|or|of|the|to|in|is|are|that|which)\s*$/i;
// Questions that point at a text / picture / table the student does not have cannot be solved -> dropped.
const AB = "(?<![\\u0621-\\u064A\\u0671-\\u06D3])", AE = "(?![\\u0621-\\u064A\\u0671-\\u06D3\\u064B-\\u065F\\u0670])"; // Arabic word start / end (so "نصف" is not mistaken for "نص")
const REFERS_PARTS = [
  `${AB}(?:(?:في|من|بحسب|حسب|وفق|ب|ل)\\s*(?:ال)?(?:نص|فقرة|درس|مقطع)|(?:ال)?(?:نص|فقرة|مقطع))${AE}`, // "الدرس" alone is an ordinary word (كتب الطالب الدرس): only "في الدرس / من الدرس..." points at the book
  `${AB}(?:ال)?(?:مذكور|مذكورة|مذكورات|مذكورين|وارد|واردة|موضح|موضحة|مبين|مبينة|مرفق|مرفقة)${AE}`,
  `${AB}(?:ال)?(?:شكل|جدول|صورة|رسم|مخطط|منحنى|خريطة)\\s*(?:ال)?(?:مقابل|سابق|اعلاه|أعلاه|ادناه|أدناه|التالي|الآتي|الاتي|بالأعلى|بالاسفل|بالأسفل)${AE}`,
  `${AB}(?:أعلاه|اعلاه|أدناه|ادناه)${AE}`,
  `${AB}(?:الشكل|الجدول|الصورة|الرسم)\\s*\\(?\\d`,
  `${AB}(?:صفحة|ص)\\s*\\d+`,
  "according to|\\bthe (?:text|passage|author|figure|table|diagram)\\b|\\bin the (?:text|book|passage|figure)\\b|\\bshown (?:above|below)\\b",
];
const REFERS_OUTSIDE = new RegExp(REFERS_PARTS.join("|"), "i");
// math: "ص" is a variable (س، ص), so the page-number rule "ص 12" is left out
const REFERS_MATH = new RegExp(REFERS_PARTS.filter((x) => !x.includes("(?:صفحة|ص)")).join("|"), "i");
function looksIncomplete(t: string, short = false, math = false, listLike = false): boolean {
  if ((math ? REFERS_MATH : REFERS_OUTSIDE).test(t)) return true;
  if (listLike) return (t.match(/[\p{L}\p{N}]/gu) ?? []).length < 12; // a scrambled list (put in order / match) ends with any word: only the length is checked
  const s = t.replace(/[\s؟?.:،,!]+$/u, "");
  if ((s.match(/[\p{L}\p{N}]/gu) ?? []).length < (short ? 6 : 12)) return true;
  if (s.split(/\s+/).length < (short ? 2 : 3)) return true;
  return DANGLING.test(s);
}

export function cleanOne(r: Raw, allowed: string[], math = false, subject = ""): Q | null {
  const kind = r.type as Q["kind"];
  let text = (r.text ?? "").trim();
  if (kind === "match") text = subject === "english" ? "Match column ( A ) with column ( B ):" : "صل من العمود ( أ ) ما يناسبه من العمود ( ب ):";
  if (!text || !allowed.includes(kind)) return null;
  // a story is a whole text and a map question points at the picture printed above it on purpose: they have their own checks below
  if (kind !== "story" && kind !== "map" && looksIncomplete(text, kind === "define" || kind === "vocab" || math, math, kind === "order" || kind === "match")) return null; // cut-off or too short to stand alone: better no question than a broken one
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
  if (kind === "solve") {
    if (!/[0-9٠-٩]/.test(text) || !/[0-9٠-٩]/.test(answer)) return null; // a math question needs given numbers and a numeric final answer
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "reason") {
    if (answer.length < 8) return null;
    if (!/^\s*علل/.test(text)) text = "علل: " + text;
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "problem") {
    if (!/\d/.test(text) || answer.length < 6 || !/\d/.test(answer)) return null; // a problem needs given numbers and a worked numeric answer
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "balance") {
    const given = text.split(/[:：]/).slice(1).join(":");
    if (!/[→⟶]|->/.test(given) || !/[→⟶]|->/.test(answer)) return null;
    if (balanceCheck(given) === true) return null;   // the equation given to the student is already balanced: no question
    if (balanceCheck(answer) === false) return null; // the AI's answer is checked atom by atom: unbalanced -> dropped
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "write") {
    if (/[→⟶]|->/.test(text)) return null;          // the question must not give the equation away
    if (!/[→⟶]|->/.test(answer) || balanceCheck(answer) === false) return null;
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "term") {
    if (answer.length < 2 || answer.split(/\s+/).length > 6) return null;
    if (norm(text).includes(norm(answer))) return null;        // the question gives the term away
    if (!/^\s*اكتب المصطلح/.test(text)) text = (subject === "science" ? "اكتب المصطلح العلمي: " : "اكتب المصطلح: ") + text;
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "define") {
    if (answer.length < 10) return null;
    if (!/^\s*(?:عرف|عرّف|ما المقصود|ما تعريف)/.test(text)) text = "عرّف: " + text;
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "compare") {
    if (answer.length < 15 || !/قارن|الفرق|ما الفرق/.test(text)) return null;
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "fill") {
    text = text.replace(/(?:_\s*){3,}|\.{4,}|…{2,}|\(\s{2,}\)|\[\s*\]/g, "______");
    const blanks = (text.match(/______/g) ?? []).length;
    if (blanks < 1 || blanks > 3 || answer.length < 1) return null;
    if (math && (!/[0-9٠-٩]/.test(text) || !/[0-9٠-٩a-zA-Zسصعمنلك√π]/.test(answer) || answer.length > 40)) return null; // a math blank needs given numbers and a short value as its answer
    if (answer.split(/\s+-\s+/).length < blanks && blanks > 1) return null;
    return { kind, text, choices: [], answer, explanation };
  }
  const squash = (x: string) => norm(x).replace(/[\s.،,؟?!:؛;"'«»()\[\]\-–—←→/]+/g, "");
  if (kind === "map") {
    // answered by LOOKING at the map printed above the question: it needs a real question and a short exact answer, and must not point at a book page
    if (LETTERS_N(text) < 10 || answer.length < 2 || answer.length > 200) return null;
    if (/(?:صفحة|ص)\s*\d+/.test(text)) return null;
    if (/[?؟]\s*$/.test(text) === false && !/^(?:حدد|اذكر|اكتب|عدد|عدّد|استخرج|ما|ماذا|أي|اي|من|أين|اين|كم|بيّن|بين|وضح)/.test(text)) return null; // a question or a clear instruction
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "story") {
    // an English story + 3-6 questions about it. The story and every answer must be English, the questions must differ, the answers must be short.
    const words = text.split(/\s+/).filter(Boolean).length;
    const pairs: Array<[string, string]> = [];
    for (const c of Array.isArray(r.choices) ? r.choices : []) {
      const [a, ...rest] = String(c).split("|||");
      const q = (a ?? "").trim(), ans = rest.join("|||").trim();
      if (q && ans) pairs.push([q, ans]);
    }
    if (words < 35 || words > 420 || pairs.length < 3 || pairs.length > 6) return null;
    if (/[\u0600-\u06FF]/.test(text) || pairs.some(([q, a]) => /[\u0600-\u06FF]/.test(q + a))) return null;
    if (pairs.some(([q, a]) => q.length < 8 || a.length > 180)) return null;
    if (new Set(pairs.map((p) => squash(p[0]))).size !== pairs.length) return null;
    if (/[^.!?"'”’)]\s*$/.test(text)) return null;                // the story stops in the middle of a sentence
    return { kind, text, choices: pairs.map((p) => `${p[0]} ||| ${p[1]}`), answer: pairs.map((p) => p[1]).join("\n"), explanation };
  }
  if (kind === "match") {
    const pairs: Array<[string, string]> = [];
    for (const c of Array.isArray(r.choices) ? r.choices : []) {
      const [a, ...rest] = String(c).split("|||");
      const l = (a ?? "").trim(), rr = rest.join("|||").trim();
      if (l && rr) pairs.push([l, rr]);
    }
    if (pairs.length < 3 || pairs.length > 6) return null;
    if (new Set(pairs.map((p) => squash(p[0]))).size !== pairs.length || new Set(pairs.map((p) => squash(p[1]))).size !== pairs.length) return null; // a repeated item makes the matching ambiguous
    return { kind, text, choices: pairs.map((p) => `${p[0]} ||| ${p[1]}`), answer: pairs.map((p) => `${p[0]} ← ${p[1]}`).join("\n"), explanation };
  }
  if (kind === "order") {
    const given = text.split(/[:：]/).slice(1).join(":");
    const parts = given.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 3 || parts.length > 10 || answer.length < 6) return null;
    const ansParts = answer.split(/\s*(?:←|->|→)\s*/).map((x) => x.trim()).filter(Boolean);
    if (ansParts.length === parts.length && ansParts.every((x, i) => squash(x) === squash(parts[i]))) return null; // not scrambled
    if (squash(parts.join(" ")) === squash(answer)) return null;                                                    // not scrambled
    if (!parts.every((x) => squash(answer).includes(squash(x)))) return null;                                        // the answer must use exactly what was given
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "vocab") {
    if (!answer || answer.length > 40 || answer.split(/\s+/).length > 4) return null;
    if (norm(text).includes(norm(answer))) return null; // the question gives the answer away
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "irab") {
    if (!/\([^)]{2,}\)/.test(text) || answer.length < 8) return null; // the words to parse must be between brackets
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "extract" || kind === "rhetoric" || kind === "list") {
    if (answer.length < (kind === "list" ? 8 : 2) || (kind !== "list" && text.length < 25)) return null;
    return { kind, text, choices: [], answer, explanation };
  }
  if (kind === "correct" || kind === "rewrite") {
    const given = text.split(/[:：]/).slice(1).join(":") || text;
    if (answer.length < 6 || squash(given) === squash(answer)) return null; // nothing was corrected / rewritten
    return { kind, text, choices: [], answer, explanation };
  }
  return { kind: "essay", text, choices: [], answer, explanation };
}

