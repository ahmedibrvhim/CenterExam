// Subject configuration: each subject decides which question types the tool offers (picked from ONE shared pool, see Kind),
// how they are worded on the exam sheet, and which of them each grade uses. The file analysis (lib/analyze.ts) and the AI rules
// (app/api/generate/route.ts) are written per type, so a type behaves the same in every subject that uses it.

// ONE shared pool of question types. Every subject picks the types it needs from this pool, so the same type
// (for example "قارن" or "صل") behaves, is analysed, is written by the AI and is printed the same way in every subject.
export type Kind =
  // objective
  | "mcq" | "tf" | "fill" | "match" | "order"
  // knowledge
  | "term" | "define" | "vocab"
  // understanding
  | "reason" | "compare" | "list" | "essay"
  // reading / pictures: a short story with questions (English) and a map taken from the book with its questions (social studies)
  | "story" | "map"
  // skills (calculation / chemistry / language)
  | "problem" | "solve" | "balance" | "write" | "irab" | "extract" | "rhetoric" | "correct" | "rewrite";
// also the order of the sections on the exam sheet when a subject does not say otherwise. "essay" and "problem" are no longer offered for science, but exams saved earlier still use them.
export const ALL_KINDS: Kind[] = [
  "mcq", "tf", "reason", "balance", "write", "term", "define", "compare", "fill", "essay", "problem", "solve",
  "vocab", "irab", "extract", "rhetoric", "correct", "rewrite", "match", "order", "list", "story", "map",
];
export const zeroCounts = (): Record<Kind, number> => Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<Kind, number>;
export const zeroTexts = (): Record<Kind, string> => Object.fromEntries(ALL_KINDS.map((k) => [k, "0"])) as Record<Kind, string>;

export type Stage = "primary" | "prep" | "secondary";
export type Branch = "general" | "physics" | "chemistry" | "biology" | "geology";

// How the types are grouped in the tool (the same four groups in every subject, so the page always looks the same).
export type Group = "objective" | "knowledge" | "understanding" | "skills";
export const GROUP_ORDER: Group[] = ["objective", "knowledge", "understanding", "skills"];
export const GROUP_LABEL: Record<Group, string> = { objective: "أسئلة موضوعية", knowledge: "معرفة ومصطلحات", understanding: "فهم وتحليل", skills: "مهارات" };

export type KindDef = {
  id: Kind;
  label: string;         // shown in the tool
  hint: string;          // one short line under the field
  section: string;       // heading printed on the exam sheet
  group: Group;
  // grades (1..6) where the type is used, per stage. A stage that is missing = the type is not used there. "all" = every grade.
  grades: Partial<Record<Stage, number[] | "all">>;
};

export type SubjectId = "science" | "arabic" | "social" | "english" | "math";

export type Subject = {
  id: SubjectId;
  name: string;
  icon: string;
  ready: boolean;        // every subject now has its own question types and its own file analysis
  lang: "ar" | "en";     // language the exam sheet is printed in (headings, answer labels)
  scope: string;         // what the subject covers (shown on the subject card)
  skillsTitle: string;   // title of the "skills" group for this subject
  kinds: KindDef[];
};

const ALL: KindDef["grades"] = { primary: "all", prep: "all", secondary: "all" };
const NOT_PRIMARY: KindDef["grades"] = { prep: "all", secondary: "all" };

// ---- the types every subject shares (same id, same behaviour; only the wording on the sheet changes per subject) ----
const MCQ_AR: KindDef = { id: "mcq", label: "اختر", hint: "أربع إجابات والصحيحة واحدة", section: "اختر الإجابة الصحيحة من بين الإجابات المعطاة", group: "objective", grades: ALL };
const TF_AR: KindDef = { id: "tf", label: "صح وخطأ", hint: "عبارة صحيحة أو خاطئة", section: "ضع علامة ( ✓ ) أمام العبارة الصحيحة وعلامة ( ✗ ) أمام العبارة الخاطئة", group: "objective", grades: ALL };
const FILL_AR: KindDef = { id: "fill", label: "أكمل", hint: "فراغ واحد أو اثنان في الجملة", section: "أكمل الفراغات الآتية بما يناسبها", group: "objective", grades: ALL };
const MATCH_AR: KindDef = { id: "match", label: "صل", hint: "عمودان: صل كل عنصر بما يناسبه", section: "صل من العمود ( أ ) ما يناسبه من العمود ( ب )", group: "objective", grades: ALL };
const TERM: KindDef = { id: "term", label: "اكتب المصطلح", hint: "وصف والطالب يكتب المصطلح", section: "اكتب المصطلح العلمي الدال على كل عبارة مما يأتي", group: "knowledge", grades: ALL };
const DEFINE: KindDef = { id: "define", label: "عرّف", hint: "تعريف مفهوم من الدرس", section: "عرّف كلًّا مما يأتي", group: "knowledge", grades: ALL };
const REASON: KindDef = { id: "reason", label: "علّل", hint: "عبارة لها سبب في الدرس", section: "علّل لما يأتي", group: "understanding", grades: ALL };
const COMPARE: KindDef = { id: "compare", label: "قارن", hint: "مقارنة بين شيئين من عدة أوجه", section: "قارن بين كل مما يأتي", group: "understanding", grades: ALL };

export const SUBJECTS: Subject[] = [
  {
    id: "science", name: "العلوم", icon: "🔬", ready: true, lang: "ar", scope: "علوم عامة · فيزياء · كيمياء · أحياء", skillsTitle: "معادلات ومسائل",
    kinds: [
      MCQ_AR, TF_AR, FILL_AR,
      { ...TERM }, { ...DEFINE },
      { ...REASON }, { ...COMPARE },
      { id: "balance", label: "وزن المعادلة", hint: "معادلة غير موزونة", section: "زن المعادلات الكيميائية الآتية", group: "skills", grades: { prep: [2], secondary: "all" } },
      { id: "write", label: "كتابة المعادلة", hint: "من الكلمات إلى الرموز", section: "اكتب المعادلات الكيميائية الرمزية الموزونة لكل مما يأتي", group: "skills", grades: { prep: [3], secondary: "all" } },
      { id: "problem", label: "مسائل (احسب)", hint: "قانون وأرقام ووحدات", section: "احسب ما يأتي", group: "skills", grades: NOT_PRIMARY },
    ],
  },
  {
    id: "math", name: "الرياضيات", icon: "➗", ready: true, lang: "ar", scope: "حساب · جبر · هندسة · إحصاء", skillsTitle: "حل المسائل",
    kinds: [
      MCQ_AR, FILL_AR,
      { id: "solve", label: "أجب عن الأسئلة", hint: "مسألة تُحلّ بخطوات", section: "أجب عن الأسئلة الآتية", group: "skills", grades: ALL },
    ],
  },
  {
    id: "arabic", name: "العربي", icon: "📖", ready: true, lang: "ar", scope: "قراءة · أدب · نحو · صرف · بلاغة", skillsTitle: "مهارات لغوية",
    kinds: [
      MCQ_AR, TF_AR, FILL_AR,
      { ...MATCH_AR, section: "صل من العمود ( أ ) ما يناسبه من العمود ( ب )" },
      { id: "order", label: "رتّب", hint: "كلمات مبعثرة لتكوين جملة", section: "رتّب الكلمات الآتية لتكوّن جملة مفيدة", group: "objective", grades: ALL },
      { id: "vocab", label: "مفردات", hint: "مرادف · ضد · جمع · مفرد", section: "اكتب ما يُطلب منك في كل كلمة مما يأتي", group: "knowledge", grades: ALL },
      { ...REASON },
      { id: "essay", label: "فهم واستيعاب", hint: "اشرح · ما الفكرة · ما المقصود", section: "أجب عن الأسئلة الآتية", group: "understanding", grades: ALL },
      { id: "irab", label: "أعرب", hint: "إعراب كلمة أو جملة", section: "أعرب ما بين القوسين فيما يأتي", group: "skills", grades: { primary: [5, 6], prep: "all", secondary: "all" } },
      { id: "extract", label: "استخرج", hint: "فاعل · حال · مفعول به …", section: "استخرج مما يأتي ما يُطلب", group: "skills", grades: ALL },
      { id: "rhetoric", label: "بلاغة", hint: "تشبيه · استعارة · كناية …", section: "وضّح الصورة البلاغية فيما يأتي", group: "skills", grades: NOT_PRIMARY },
    ],
  },
  {
    id: "social", name: "الدراسات", icon: "🌍", ready: true, lang: "ar", scope: "تاريخ · جغرافيا · تربية وطنية", skillsTitle: "مهارات",
    kinds: [
      MCQ_AR, TF_AR, FILL_AR,
      { ...MATCH_AR },
      { id: "order", label: "رتّب الأحداث", hint: "ترتيب زمني أو منطقي", section: "رتّب الآتي ترتيبًا زمنيًا", group: "objective", grades: ALL },
      { ...TERM, section: "اكتب المصطلح الدال على كل عبارة مما يأتي" }, { ...DEFINE },
      { ...REASON }, { ...COMPARE },
      { id: "list", label: "اذكر / عدّد", hint: "أسباب · نتائج · أمثلة", section: "اذكر ما يأتي", group: "understanding", grades: ALL },
      // the map is cut out of the book page (lib/maps.ts) and printed on the exam above its questions
      { id: "map", label: "أسئلة الخرائط", hint: "خريطة من الكتاب تُطبع في الاختبار مع أسئلتها", section: "أجب عن الأسئلة الآتية مستعينًا بالخريطة", group: "skills", grades: ALL },
    ],
  },
  {
    id: "english", name: "الانجليزي", icon: "🔤", ready: true, lang: "en", scope: "Vocabulary · Grammar · Reading", skillsTitle: "مهارات اللغة",
    kinds: [
      { ...MCQ_AR, section: "Choose the correct answer" },
      { ...TF_AR, section: "Put ( ✓ ) or ( ✗ )" },
      { ...FILL_AR, section: "Complete the following" },
      { ...MATCH_AR, section: "Match column ( A ) with column ( B )" },
      { id: "order", label: "رتّب", hint: "كلمات مبعثرة لتكوين جملة", section: "Put the words in the correct order to make a sentence", group: "objective", grades: ALL },
      { id: "vocab", label: "مفردات", hint: "synonym · opposite · plural", section: "Write the synonym, the opposite or the plural as asked", group: "knowledge", grades: ALL },
      { id: "essay", label: "فهم واستيعاب", hint: "أجب بجملة كاملة", section: "Answer the following questions", group: "understanding", grades: ALL },
      // a short story written by the AI at the reading age of the grade found in the book (lib/detect.ts), followed by questions about it
      { id: "story", label: "قصة (Story)", hint: "قصة قصيرة بمستوى سنّ الطالب + أسئلتها", section: "Read the story, then answer the questions", group: "understanding", grades: ALL },
      { id: "correct", label: "صحّح", hint: "صحّح الخطأ في الجملة", section: "Correct the mistake in each of the following sentences", group: "skills", grades: ALL },
      { id: "rewrite", label: "أعد الكتابة", hint: "مبني للمجهول · سؤال · نفي …", section: "Rewrite the following sentences as shown", group: "skills", grades: ALL },
    ],
  },
];

export const getSubject = (id: string | null | undefined): Subject | undefined => SUBJECTS.find((s) => s.id === id);

// Sheet headings and labels. A subject can word a type its own way ("مفردات" in Arabic and English, "عرّف" in science...), so ask with the subject first.
const FIRST_DEF = (pick: (k: KindDef) => string) => {
  const m = {} as Record<Kind, string>;
  for (const s of SUBJECTS) for (const k of s.kinds) if (!m[k.id]) m[k.id] = pick(k);
  return m;
};
export const SECTION_TITLE: Record<Kind, string> = FIRST_DEF((k) => k.section);
export const KIND_LABEL: Record<Kind, string> = {
  mcq: "اختر", tf: "صح وخطأ", essay: "نظري", reason: "علّل", problem: "مسألة", balance: "وزن معادلة", write: "كتابة معادلة",
  term: "اكتب المصطلح", define: "عرّف", compare: "قارن", fill: "أكمل", solve: "أجب",
  vocab: "مفردات", irab: "أعرب", extract: "استخرج", rhetoric: "بلاغة", correct: "صحّح", rewrite: "أعد الكتابة", match: "صل", order: "رتّب", list: "اذكر / عدّد", story: "قصة", map: "خريطة",
};
export const sectionTitle = (subject: string | null | undefined, k: Kind): string => getSubject(subject)?.kinds.find((d) => d.id === k)?.section ?? SECTION_TITLE[k];
export const kindLabel = (subject: string | null | undefined, k: Kind): string => getSubject(subject)?.kinds.find((d) => d.id === k)?.label ?? KIND_LABEL[k];
// the order of the sections on the sheet: the subject's own order first, then any other type found in the questions (exams saved by older releases)
export const kindOrder = (subject: string | null | undefined): Kind[] => {
  const own = getSubject(subject)?.kinds.map((d) => d.id) ?? [];
  return [...own, ...ALL_KINDS.filter((k) => !own.includes(k))];
};

export const STAGE_LABEL: Record<Stage, string> = { primary: "المرحلة الابتدائية", prep: "المرحلة الإعدادية", secondary: "المرحلة الثانوية" };
export const STAGE_SHORT: Record<Stage, string> = { primary: "الابتدائي", prep: "الإعدادي", secondary: "الثانوي" };
export const BRANCH_LABEL: Record<Branch, string> = { general: "علوم عامة", physics: "فيزياء", chemistry: "كيمياء", biology: "أحياء", geology: "جيولوجيا" };
export const GRADE_ORD = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
// Reading age of the pupils (Egypt: primary 1 = 6 years old ... secondary 3 = 18). Used so the AI writes a story of the right level.
export const ageOf = (st: Stage | null, lv: number | null): number | null =>
  st === "primary" ? (lv ? 5 + lv : 9) : st === "prep" ? (lv ? 11 + lv : 13) : st === "secondary" ? (lv ? 14 + lv : 16) : null;
export const gradesOf = (st: Stage) => (st === "primary" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3]);
export const gradeName = (st: Stage | null, lv: number | null) => (st && lv ? `الصف ${GRADE_ORD[lv - 1]} ${STAGE_SHORT[st]}` : null);

// What the file analysis found for each question type in the chosen pages.
//  n = how much material supports the type, suggest = how many questions of it one copy could sensibly have.
export type KindAvail = { ok: boolean; n: number; suggest: number; why?: string };
export type Avail = Partial<Record<Kind, KindAvail>>;

// null = nothing analysed yet (the analysis runs only after the teacher typed the page numbers)
export function kindStatus(k: KindDef, stage: Stage | null, level: number | null, avail: Avail | null): { ok: boolean; why?: string } {
  if (stage) {
    const g = k.grades[stage];
    if (!g) return { ok: false, why: `لا يُستخدم في ${STAGE_LABEL[stage]}` };
    if (g !== "all" && level && !g.includes(level)) return { ok: false, why: `لا يُستخدم في ${gradeName(stage, level)}` };
  }
  const a = avail?.[k.id];
  if (a && !a.ok) return { ok: false, why: a.why || "لا تدعمه الصفحات المحددة" };
  return { ok: true };
}

// Default counts for ONE copy of the exam: every box starts at 0 - the teacher chooses (or presses "apply the suggestion" after the file analysis).
export function defaultCounts(_subject: Subject): Record<Kind, number> {
  return zeroCounts();
}
