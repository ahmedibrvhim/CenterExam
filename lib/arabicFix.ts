// Cleans the text that Tesseract reads from an ARABIC page, with the grammar (نحو / صرف / إعراب) pages in mind.
//
// What goes wrong on a grammar page:
//   1. The grammar terms lose their hamza / تاء مربوطة / ألف مقصورة:  "مبتدا"  "الجمله الاسميه"  "علامه الرفع"  "كان واخواتها"
//   2. The little diacritic marks (التشكيل) are invented from specks of dust, doubled, or left alone after a space.
//   3. Stray symbols from the page border / dots / table lines get glued to the text:  "| ~ _ ^"
//   4. Spaces around brackets and punctuation are wrong:  "( الطالبُ )"  "مجتهد ،"
// Everything here is a fixed rule (no AI, no network): the result is the same every time and it can be tested.

const DIAC = "\\u064B-\\u0652\\u0670";                 // tanween, harakat, shadda, sukun, dagger alef
const AR_LETTER = "\\u0621-\\u064A\\u0671-\\u06D3";
const HAS_DIAC = new RegExp(`[${DIAC}]`);
const ONLY_LETTERS = new RegExp(`^[${AR_LETTER}]+$`);

// the same "skeleton" as lib/analyze.ts norm(): no diacritics, أ/إ/آ/ٱ -> ا, ى -> ي, ة -> ه
const skel = (w: string) => w.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

// The correct spelling of the grammar vocabulary (no diacritics). One word per entry. The same word with the article "ال"
// and after one of the prefixes و ف ب ك ل is covered automatically ("بالجملة", "للمبتدأ", "والفاعل").
const TERMS = `
مبتدأ خبر فاعل مفعول نائب نعت صفة منعوت مضاف إليه اليه مضاف جار مجرور ظرف حال تمييز بدل معطوف توكيد مؤكد
أعرب إعراب استخرج
جملة اسمية فعلية أسماء أفعال
ماضي مضارع أمر مبني معرب مبنية معربة
مرفوع منصوب مجرور مجزوم مرفوعة منصوبة مجرورة مجزومة
علامة علامات ضمة فتحة كسرة ظاهرة مقدرة ألف أصلية
أداة أدوات جازم ناصب جازمة ناصبة الشرط
أخوات أخواتها
نافية ناهية ناسخ نواسخ استفهام استثناء مستثنى منادى نداء ندبة تعجب إغراء تحذير
موصول موصولة إشارة ضمير متصل منفصل مستتر بارز عائد
مثنى مفرد جمع مذكر مؤنث سالم تكسير منقوص مقصور ممدود صحيح معتل مجرد مزيد لازم متعدٍّ
مصدر مشتق جامد مبالغة تفضيل مشبهة
مطلق لأجله لأجل
تثنية إضافة معرفة نكرة
خمسة
ممنوع
مجهول معلوم
إملائي همزة قطع وصل تاء مربوطة مفتوحة
بلاغة تشبيه استعارة كناية طباق مقابلة جناس سجع مشبه بيانية بديعية محسنات
`.split(/\s+/).filter((w) => w.length >= 3).map((w) => w.replace(/[\u064B-\u065F\u0670]/g, ""));

const MAP = new Map<string, string>();       // skeleton -> correct spelling (the first spelling listed wins)
for (const t of TERMS) { const k = skel(t); if (!MAP.has(k)) MAP.set(k, t); }
const CORE_FIX: Record<string, string> = {}; // used by the tests / for debugging
for (const [k, v] of MAP) CORE_FIX[k] = v;

// One word: split it into prefix + article + core, look the core up, and rebuild it with the right spelling.
function fixWord(tok: string): string {
  if (HAS_DIAC.test(tok) || !ONLY_LETTERS.test(tok)) return tok; // a voweled word is an example from the lesson: never touched
  const tries: Array<{ pre: string; rest: string }> = [{ pre: "", rest: tok }];
  if (/^[وفبكل]/.test(tok) && tok.length > 3) tries.push({ pre: tok[0], rest: tok.slice(1) });
  for (const { pre, rest } of tries) {
    let art = "", core = rest;
    if (pre === "ل" && rest.startsWith("ل") && rest.length > 4) { art = "ل"; core = rest.slice(1); }          // للجملة = ل + ال + جملة
    else if (/^(?:ال|أل|إل)/.test(rest) && rest.length > 4) { art = "ال"; core = rest.slice(2); }
    const k = skel(core);
    const hit = k.length >= 3 ? MAP.get(k) : undefined;
    if (hit) return pre + art + hit;
  }
  return tok;
}

// "ان واخواتها" -> "إنّ وأخواتها" (the word "ان" alone is too common to be changed anywhere else)
const PHRASES: Array<[RegExp, string]> = [
  [/(^|\s)[اأإ]ن\s+وأخواتها/g, "$1إنّ وأخواتها"],
];

// Keep ONE shadda and ONE vowel mark per letter, and drop marks that are not on a letter.
function tidyDiacritics(t: string): string {
  const orphan = new RegExp(`(^|[^${AR_LETTER}${DIAC}])[${DIAC}]+`, "g");
  const stack = new RegExp(`([${AR_LETTER}])([${DIAC}]{2,})`, "g");
  return t.replace(orphan, "$1").replace(stack, (_m, letter: string, marks: string) => {
    const shadda = marks.includes("\u0651") ? "\u0651" : "";
    const vowel = [...marks].find((c) => c !== "\u0651") ?? "";
    return letter + shadda + vowel;
  });
}

export function fixArabicLine(line: string): string {
  if (!new RegExp(`[${AR_LETTER}]`).test(line)) return line;
  let l = line.replace(/\u0640/g, "");                                       // tatweel
  if (!/[A-Za-z]{2,}/.test(l)) l = l.replace(/[|~_^`©®¢§¦¬‖]+/g, " ");       // symbols that are not part of an Arabic sentence
  l = tidyDiacritics(l)
    .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\[\s+/g, "[").replace(/\s+\]/g, "]")
    .replace(/\s+([،؛؟!:.])/g, "$1")
    .replace(/([،؛؟])(?=[^\s\d)\]»"'])/g, "$1 ")
    .replace(/[ \t]{2,}/g, " ").trim();
  const wordShape = new RegExp(`^([^${AR_LETTER}${DIAC}]*)([${AR_LETTER}${DIAC}]+)([^${AR_LETTER}${DIAC}]*)$`);
  l = l.split(/(\s+)/).map((w) => {
    if (!w || /^\s+$/.test(w)) return w;
    const m = w.match(wordShape);                                            // brackets / punctuation stay outside the corrected word
    return m ? m[1] + fixWord(m[2]) + m[3] : w;
  }).join("");
  for (const [re, to] of PHRASES) l = l.replace(re, to);
  return l;
}

// A whole page (the lines are kept; only lines that contain Arabic are changed).
export function fixArabicPage(text: string): string {
  return text.split("\n").map(fixArabicLine).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
