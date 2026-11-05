// Reads the chosen pages (locally, NO AI request - it never touches anybody's Gemini key) to find the school stage + grade, the science branch,
// and which question types the pages can support (see lib/analyze.ts). Nothing is asked from the teacher.
//
// Where the grade comes from (first that works):
//   1. "cover"   - a phrase like "الصف الثاني الإعدادي" on the cover / first pages (many spellings: ئ/ي, ة/ه, ى/ي, colloquial, digits)
//   2. "text"    - the same phrase, or only the stage ("المرحلة الإعدادية"), anywhere in the chosen pages
//   3. "lessons" - the LESSON / UNIT NAMES (headings and table-of-contents lines) matched against typical topics of each stage
import type { Avail, Branch, Stage } from "@/lib/subjects";
import { englishReadingAge, evidenceFor, extractSignals, focusFor, norm } from "@/lib/analyze";
import { ageOf } from "@/lib/subjects";

export type DetectSource = "cover" | "text" | "lessons" | null;
export type Detected = {
  stage: Stage | null; level: number | null; grade: string | null; branch: Branch;
  avail: Avail; pages: number; facts: number;
  source: DetectSource;        // how the stage was found (null = not found)
  lessons: string[];           // lesson / unit names found in the pages
  focus: string[];             // what the pages mostly teach (نحو / بلاغة / تواريخ وأحداث / Grammar ...), per subject
  age: number | null;          // reading age of the pupils (from the grade; for English also estimated from the text): used to write stories at the right level
};

// norm() + the letters it leaves alone (ئ in "ابتدائي", ؤ) + Arabic-Indic digits
const n2 = (s: string) => norm(s).replace(/[ئ]/g, "ي").replace(/[ؤ]/g, "و").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

const ORD_WORDS: Array<[number, string]> = [
  [1, "اولي|اول"], [2, "ثانيه|تانيه|ثاني|تاني"], [3, "ثالثه|تالته|ثالث|تالت"], [4, "رابعه|رابع"], [5, "خامسه|خامس"], [6, "سادسه|سادس"],
];
const ORD_ALT = ORD_WORDS.map(([, w]) => w).join("|");
const NOT_LETTER = "(?![\\u0621-\\u064A])";
const STAGE_ALT = "ابتدايي|اعدادي|ثانوي";
const levelOfWord = (w: string) => ORD_WORDS.find(([, alt]) => alt.split("|").includes(w))?.[0] ?? null;
const stageOfWord = (w: string): Stage => (w === "ابتدايي" ? "primary" : w === "اعدادي" ? "prep" : "secondary");
const GRADE_AR = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
const STAGE_AR: Record<Stage, string> = { primary: "الابتدائي", prep: "الإعدادي", secondary: "الثانوي" };

type Hit = { stage: Stage; level: number | null };
// "الصف الثاني الاعدادي" / "للصف ثانية اعدادي" / "الثالث ب الثانوي" is NOT matched on purpose; "الصف 2 الاعدادي" / "2 اعدادي" is.
const GRADE_WORD = new RegExp(`(?:^|[^\\u0621-\\u064A])(?:ال)?(${ORD_ALT})${NOT_LETTER}\\s*(?:ال|ب)?\\s*(${STAGE_ALT})${NOT_LETTER}`, "g");
const GRADE_NUM = new RegExp(`(?:الصف|للصف|سنه|فرقه)\\s*([1-6])\\s*(?:ال|ب)?\\s*(${STAGE_ALT})${NOT_LETTER}`, "g");
const STAGE_ONLY = new RegExp(`(?:الصف|المرحله|مرحله|للمرحله)\\s*(?:ال)?(${STAGE_ALT}|ابتدايه|اعداديه|ثانويه)${NOT_LETTER}`, "g");

function gradeHits(text: string): Hit[] {
  const out: Hit[] = [];
  for (const m of text.matchAll(GRADE_WORD)) { const lv = levelOfWord(m[1]); if (lv) out.push({ stage: stageOfWord(m[2]), level: lv }); }
  for (const m of text.matchAll(GRADE_NUM)) out.push({ stage: stageOfWord(m[2]), level: Number(m[1]) });
  // English covers: "Primary 4", "Prep 2", "Secondary 1", "4th Primary", "Grade 5" (Egypt: grades 1-6 primary, 7-9 prep, 10-12 secondary)
  const st = (w: string): Stage => (/^primary/i.test(w) ? "primary" : /^prep/i.test(w) ? "prep" : "secondary");
  for (const m of text.matchAll(/\b(primary|prep(?:aratory)?|secondary)\s*(?:school\s*)?(?:year\s*|grade\s*|stage\s*)?([1-6])\b/gi)) out.push({ stage: st(m[1]), level: Number(m[2]) });
  for (const m of text.matchAll(/\b([1-6])(?:st|nd|rd|th)?\s*(primary|prep(?:aratory)?|secondary)\b/gi)) out.push({ stage: st(m[2]), level: Number(m[1]) });
  for (const m of text.matchAll(/\bgrade\s*(1[0-2]|[1-9])\b/gi)) { const g = Number(m[1]); out.push(g <= 6 ? { stage: "primary", level: g } : g <= 9 ? { stage: "prep", level: g - 6 } : { stage: "secondary", level: g - 9 }); }
  return out;
}
function stageHits(text: string): Stage[] {
  const out: Stage[] = [];
  for (const m of text.matchAll(STAGE_ONLY)) out.push(m[1].startsWith("ابتداي") ? "primary" : m[1].startsWith("اعداد") ? "prep" : "secondary");
  for (const m of text.matchAll(/ثانويه عامه|الثانويه العامه/g)) out.push("secondary");
  return out;
}
// the most frequent hit (a cover repeats its grade; a stray mention in a lesson does not win)
function top<T>(items: T[], key: (t: T) => string): T | null {
  const c = new Map<string, { n: number; v: T }>();
  for (const it of items) { const k = key(it), e = c.get(k); if (e) e.n++; else c.set(k, { n: 1, v: it }); }
  return [...c.values()].sort((a, b) => b.n - a.n)[0]?.v ?? null;
}
const validLevel = (stage: Stage, lv: number | null) => (lv && lv >= 1 && lv <= (stage === "primary" ? 6 : 3) ? lv : null);

// ---- lesson / unit names: headings ("الدرس الأول: ...", "الوحدة الثانية ...") and table-of-contents lines ("عنوان ..... 12") ----
const HEADING = /^(?:الدرس|الوحده|الفصل|الباب|الموضوع|درس|وحده)\s*(?:ال[ء-ي]+|\d+)?\s*[:\-–.،]?\s*(.{3,70})$/;
const TOC_LINE = /^(.{4,70}?)\s*[.…·\-_\s]{3,}\s*\d{1,3}$/;
const ORD_ONLY = new RegExp(`^(?:ال)?(?:${ORD_ALT})$`);
export function lessonNames(pages: string[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const page of pages) for (const raw of page.split("\n")) {
    const line = n2(raw).replace(/\s+/g, " ").trim();
    if (line.length < 4 || line.length > 90) continue;
    const t = (HEADING.exec(line)?.[1] ?? TOC_LINE.exec(line)?.[1] ?? "").replace(/[.…·\-_\s]+$/, "").trim();
    if (t.length < 3 || /^\d+$/.test(t) || ORD_ONLY.test(t) || seen.has(t)) continue;   // "الفصل الدراسي الأول" is not a lesson
    seen.add(t); out.push(t);
    if (out.length >= 80) return out;
  }
  return out;
}

// Typical topics (normalised spelling) per stage. One match = one point; a topic found in a lesson NAME counts triple.
// Deliberately only topics that belong mostly to ONE stage: shared topics (the cell, light, force...) are left out.
const TOPICS: Record<Stage, RegExp> = {
  primary: /الحواس|دوره حياه|الفراشه|الطقس|الظل|المغناطيس|الاحتكاك|الغذاء الصحي|الاسنان|اجزاء النبات|حالات الماده|الكايناتالحيه|الكائنات الحيه|الحيوانات الاليفه|المواد الصلبه والسايله/g,
  prep: /الماده وخواصها|الجدول الدوري|الروابط الكيميايي|الترتيب الالكتروني|المول|التمثيل الغذايي|الجهاز الهضمي|الجهاز التنفسي|الدوره الدمويه|التكاثر في الكاينات|القوه والحركه|الشغل والقدره|الاحماض والقواعد|الكهربيه المتحركه|التيار الكهربي|العدسات|انكسار الضوء|الخليه ووظايفها|تصنيف الكاينات|الذره وتركيبها/g,
  secondary: /الاتزان الكيميايي|الهيدروكربونات|الكيمياء العضويه|الكيمياء الحراريه|الكيمياء الكهربيه|التحليل الكيميايي|الحث الكهرومغناطيسي|الديناميكا الحراريه|الفيزياء الحديثه|الهندسه الوراثيه|الوراثه الجزييي|الغدد الصماء|الدوايرالكهربيه|الكهربيه الساكنه|المجال المغناطيسي|الاكسده والاختزال|الايونات|التفاعلات الكيميايي المعقده|تفاعلات الاكسده/g,
};
function stageFromLessons(lessons: string[], body: string): Stage | null {
  const score: Record<Stage, number> = { primary: 0, prep: 0, secondary: 0 };
  const names = lessons.join(" | ");
  for (const st of Object.keys(TOPICS) as Stage[]) score[st] = 3 * (names.match(TOPICS[st])?.length ?? 0) + (body.match(TOPICS[st])?.length ?? 0);
  const rank = (Object.entries(score) as Array<[Stage, number]>).sort((a, b) => b[1] - a[1]);
  return rank[0][1] >= 3 && rank[0][1] >= rank[1][1] * 1.5 ? rank[0][0] : null;
}

export type Source = { pages: string[]; from: number; to: number };

// One entry per chosen file: its pages and the page range the teacher typed (1-based, inclusive).
export function detectFromRanges(sources: Source[], subject?: string): Detected {
  const slice = sources.flatMap((s) => s.pages.slice(Math.max(0, s.from - 1), Math.min(s.pages.length, s.to)));
  const headPages = sources.flatMap((s) => s.pages.slice(0, 8));              // cover + contents pages
  const head = n2(headPages.join("\n")).replace(/\s+/g, " ").slice(0, 12000);
  const body = n2(slice.join("\n"));
  const bodyFlat = body.replace(/\s+/g, " ");
  const lessons = lessonNames([...headPages, ...slice]);
  let stage: Stage | null = null, grade: string | null = null, level: number | null = null, source: DetectSource = null;

  const apply = (h: Hit, src: DetectSource) => {
    stage = h.stage; level = validLevel(h.stage, h.level); source = src;
    grade = level ? `الصف ${GRADE_AR[level - 1]} ${STAGE_AR[h.stage]}` : null;
  };
  const cover = top(gradeHits(head), (h) => `${h.stage}${h.level}`);
  if (cover) apply(cover, "cover");
  if (!stage) {
    const inText = top(gradeHits(bodyFlat), (h) => `${h.stage}${h.level}`);
    if (inText) apply(inText, "text");
  }
  if (!stage) {
    const st = top([...stageHits(head), ...stageHits(bodyFlat)], (s) => s);
    if (st) { stage = st; source = "text"; }
  }
  if (!stage) {
    const st = stageFromLessons(lessons, bodyFlat);
    if (st) { stage = st; source = "lessons"; }
  }

  const textForBranch = `${body} ${lessons.join(" ")} ${lessons.join(" ")}`; // lesson names count extra
  const count = (re: RegExp) => (textForBranch.match(re) ?? []).length;
  const sc = {
    physics: count(/(?:القوه|السرعه|العجله|الكهربي|المقاومه|التيار|فولت|اوم|نيوتن|الشغل|القدره|الضوء|العدسه|الحراره)/g),
    chemistry: count(/(?:ذره|عنصر|مركب|تفاعل|حمض|قاعده|محلول|الكترون|الجدول الدوري|مول|تاكسد|عامل مختزل|فلز)/g),
    biology: count(/(?:خليه|كائن|نبات|انسان|جهاز|هرمون|وراثه|الجين|كروموسوم|التمثيل الضوئي|الدم|القلب)/g),
    geology: count(/(?:صخور|معدن|زلزال|بركان|الارض|الغلاف الصخري|التجويه|الحفريات)/g),
  };
  const ranked = (Object.entries(sc) as Array<[Branch, number]>).sort((a, b) => b[1] - a[1]);
  // Egypt: science is ONE integrated subject ("علوم") in the primary and prep stages - physics / chemistry / biology / geology
  // are separate books only in secondary. So a branch is only ever picked for secondary (never when the stage is prep/primary).
  const branch: Branch = (subject && subject !== "science") || stage === "primary" || stage === "prep" ? "general"
    : ranked[0][1] >= 6 && ranked[0][1] >= (ranked[1][1] || 0) * 1.4 ? ranked[0][0] : "general";

  const sig = extractSignals(slice.join("\n"));
  const avail = evidenceFor(sig, slice.length, subject);
  const age = ageOf(stage, level) ?? (subject === "english" ? englishReadingAge(slice.join("\n")) : null);
  return { stage, level, grade, branch, avail, pages: slice.length, facts: sig.facts, source, lessons, focus: focusFor(sig, subject), age };
}
