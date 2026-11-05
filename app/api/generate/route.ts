import { NextResponse } from "next/server";
import type { Q } from "@/exam";
import { classify } from "@/lib/geminiErrors";
import { addUsage, clearDayLimit, markDayLimit } from "@/lib/store";
import { createHash } from "crypto";
import { msUntilPacificMidnight } from "@/lib/limits";
import { ALL_KINDS, BRANCH_LABEL, GRADE_ORD, STAGE_SHORT, ageOf, type Branch, type Stage } from "@/lib/subjects";
import { balanceCheck } from "@/lib/chem";
import { hintsFor, norm } from "@/lib/analyze";
import { ApiError, assertSubjectAccess, requireUser } from "@/lib/server/admin";
import { getUserKey } from "@/lib/server/userKey";
import { chargeTrialBatch } from "@/lib/server/trial";

export const runtime = "nodejs";
export const maxDuration = 60;
const DEADLINE_MS = 50_000; // stop talking to Gemini before Vercel kills the function (maxDuration) so we never return an opaque 504

// "gemini-flash-latest" always points to the current free Flash model. Override with GEMINI_MODEL if needed.
// Model names change over time (old ones get retired -> 404). So we ask Google which Flash models this key can use,
// and try them in order. Each model has its own free quota, so if one is busy / slow / over its limit the next one is used.
const FIRST_OUTPUT_MS = 15_000; // a model that writes nothing for this long is skipped
const modelCache = new Map<string, { at: number; list: string[] }>();
async function pickModels(apiKey: string): Promise<string[]> {
  const pinned = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : [];
  let found: string[] = [];
  const ck = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
  const mc = modelCache.get(ck);
  if (mc && Date.now() - mc.at < 3_600_000) found = mc.list;
  else {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(5000) });
      const j: any = await r.json();
      const names: string[] = (j.models ?? [])
        .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m: any) => String(m.name).replace(/^models\//, ""))
        .filter((n: string) => /^gemini-.*flash/.test(n) && !/(tts|image|live|audio|exp|robotics|computer|native|customtools|thinking)/.test(n));
      const rank = (n: string) => (n === "gemini-flash-latest" ? 0 : n === "gemini-flash-lite-latest" ? 1 : /preview/.test(n) ? 3 : 2);
      found = names.sort((x, y) => rank(x) - rank(y) || (y > x ? 1 : -1));
      if (found.length) { modelCache.set(ck, { at: Date.now(), list: found }); if (modelCache.size > 300) modelCache.clear(); }
    } catch {}
  }
  const fallback = ["gemini-flash-latest", "gemini-flash-lite-latest"];
  const prefer = ["gemini-2.5-flash", "gemini-2.5-flash-lite"].filter((m) => !found.length || found.includes(m));
  return [...new Set([...pinned, ...prefer, ...(found.length ? found : fallback)])].slice(0, 4);
}
const KINDS = ALL_KINDS;
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
          choices: { type: "ARRAY", items: { type: "STRING" }, description: "mcq: exactly 4 options, no letter labels. match: 4 or 5 pairs, each written 'item of column A ||| its match in column B'. every other type: empty array." },
          answer: { type: "STRING", description: "mcq: the exact text of the correct choice. tf: 'true' or 'false'. reason/define/compare/essay/list/rhetoric: a short model answer. term: the term only. vocab: the one word asked for. fill: the missing word(s) in order, separated by ' - '. problem/solve: the full worked solution ending with the final answer. balance/write: the final balanced equation. match: the same pairs, one per line 'left ← right'. order: the correct sentence, or the events from first to last joined by ' ← '. irab/extract: the complete correct answer. correct/rewrite: the complete corrected / rewritten sentence." },
          explanation: { type: "STRING", description: "One sentence showing where the text supports the answer." },
        },
        required: ["type", "text", "choices", "answer", "explanation"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM = `You are a senior exam writer for school teachers. Your questions go straight onto a printed exam, so they must be correct, clear and fair.

GROUNDING
- Use ONLY the text the user gives you. Never add facts, numbers or examples from outside it. If the text does not support a question, skip it: fewer good questions are better than invented ones.
- The text comes from a school book and was often read by OCR, so some Arabic letters may be missing or wrong (for example "يدا" instead of "يبدأ"). Understand the intended word from the context and write every word correctly. Never copy an OCR mistake.
- Write in the same language as the text (Arabic text -> Arabic questions). Use the book's own scientific terms.
- If a KEY SENTENCES list is given, build the matching question types from those sentences first.

COMPLETE, SELF-CONTAINED QUESTIONS
- Every question is a full sentence a student can answer without the book. Always name the exact subject (the element, substance, law, organ, term...). Never write vague wording such as "هذه المجموعة", "هذه العناصر", "ما سبق", "السابق", "it", "this group": use the real name from the nearest heading or sentence.
- A question ends with a question mark or a clear instruction. Never stop in the middle of a sentence.
- NO REFERENCES TO THE BOOK: the student will NOT have the book, a picture, a figure, a table or a graph. Never write "في النص", "المذكورة", "الواردة", "الموضح", "الشكل", "الجدول", "الصورة", "الرسم", "أعلاه", "أدناه", "according to the text", and never mention page numbers. If the idea needs a list (elements, substances, steps), write the names inside the question.
  Bad: "ما نظائر العناصر المذكورة في النص؟"   Good: "ما نظائر عنصر الهيدروجين؟"
- If the text contains the book's own exercise questions you may use them, written in full with the missing subject added.
- ONLY EXCEPTION: questions of type map. The exam prints the map picture right above them, so they may say "في الخريطة" / "على الخريطة". They must still never mention a page number.

QUALITY
- One idea per question. Never ask two things in one question, never ask the same idea twice, and spread the questions over different parts of the text (not all from the first paragraph).
- Difficulty must match the level asked for. Easy = recall of a stated fact. Medium = understanding / applying. Hard = cause and effect, comparison, multi-step reasoning, all still answerable from the text.
- mcq: exactly 4 choices, exactly one correct. The 3 wrong choices must be plausible and of the same kind as the right one (same category, similar length and wording): names of real things from the same topic, not silly options. Never "all of the above" / "none of the above". No letters (A/B/C/D, أ/ب/ج/د) inside the choices. The answer is copied exactly from one choice. The correct choice must not be systematically the longest.
- tf: one clear statement that is fully true or fully false, naming its subject. A false statement is a real fact with ONE key word changed to a wrong but believable one (not nonsense, not a negation with "لا"). Do not hide the answer in words like "دائمًا / أبدًا / فقط" unless the text says so. Mix true and false about evenly. answer is "true" or "false".
- explanation: one short sentence with the fact from the text that proves the answer.
- Skip tables of contents, indexes, references, headers and filler.

SELF-CHECK before you answer: every question is complete, answerable from the text alone, has one correct answer, has no outside reference, and is not a repeat. Remove any that fail.`;


// ---------- subject-specific instructions (science first; other subjects will add their own later) ----------
const STAGE_RULES: Record<Stage, string> = {
  primary: "STAGE = primary school. Use very simple words and short sentences. Only concrete ideas from the text (living things, materials, the senses, simple machines, weather...). NO formulas, NO calculations, NO chemical equations. Reason questions must have an obvious one-sentence cause.",
  prep: "STAGE = preparatory (middle) school. Use the book's own terms. Calculations only with the simple laws printed in the text (speed, density, Ohm's law...). Chemical equations only if the text shows them, and keep them short (2-4 formulas).",
  secondary: "STAGE = secondary school. Questions may require analysis, multi-step reasoning, laws with units, and balanced chemical equations with correct formulas. Use precise scientific terminology.",
};
const BRANCH_RULES: Record<Branch, string> = {
  general: "", physics: "BRANCH = physics: prefer laws, units, quantities and measurements.",
  chemistry: "BRANCH = chemistry: prefer elements, compounds, reactions, the periodic table, equations.",
  biology: "BRANCH = biology: prefer structures, functions, processes and classifications.", geology: "BRANCH = geology: prefer rocks, minerals, earth processes.",
};
const KIND_RULES: Record<string, string> = {
  essay: `- essay (theoretical question): a direct science question (ما / اذكر / فسّر / ماذا يحدث عند). answer = a short complete model answer (1-3 sentences).`,
  reason: `- reason (علّل): the text MUST begin with "علل:" followed by the COMPLETE true statement to be explained, written inside the question itself (e.g. "علل: تُستخدم الأسلاك النحاسية في التوصيلات الكهربية."). The statement must have a cause that the text gives. answer = the scientific cause in 1-2 sentences. Never ask to explain something that is not a real fact from the text.`,
  term: `- term (اكتب المصطلح): the text starts with "اكتب المصطلح العلمي:" followed by ONE complete description or definition taken from the text, WITHOUT the term itself or any word of it. answer = the term only (1-3 words) exactly as the book writes it. The description must fit one term only.`,
  define: `- define (عرّف): the text is short: "عرّف: <term>." where the term is a defined concept of the text (a law, a process, a substance, a structure...). answer = the book's definition in 1-2 sentences. Never ask to define something the text does not define.`,
  compare: `- compare (قارن): the text is "قارن بين <A> و <B> من حيث <aspect 1> و <aspect 2>." Both items and every aspect must be covered by the text. answer = one line per aspect, written "<aspect>: <A> ... / <B> ...". Only compare things the text really contrasts.`,
  fill: `- fill (أكمل): ONE complete statement from the text in which one key word or number (at most two) is replaced by "______". The blank must be a scientific term, a name or a number (never a linking word), and the rest of the sentence must make the answer unique. answer = the missing word(s) in the order of the blanks, separated by " - ".`,
  problem: `- problem (مسألة — احسب): a numeric problem solved with a law or relation that is stated in the text (or in the LAWS list). Start with "احسب" or "أوجد". Write it as plain text only (no tables or diagrams): one short paragraph that gives EVERY value WITH its unit and asks for ONE quantity. Use clean numbers that give a tidy result, consistent units, and realistic values. choices = []. answer = the worked solution, one step per line: the law, the substitution, the final value with its unit. Check the arithmetic twice. Never use a law that is not in the text.`,
  balance: `- balance (وزن المعادلة): the text MUST be "زن المعادلة الآتية:" followed by ONE UNBALANCED chemical equation written with formulas, Unicode subscripts and an arrow, e.g. "زن المعادلة الآتية: H₂ + O₂ → H₂O". The given equation must really be unbalanced. answer = the same equation, correctly BALANCED (same atoms on both sides, smallest whole-number coefficients), e.g. "2H₂ + O₂ → 2H₂O". choices = []. Use only reactions that appear in the text or follow directly from it.`,
  write: `- write (كتابة المعادلة): the text names the reactants and products IN WORDS and asks for the balanced symbolic equation, e.g. "اكتب المعادلة الكيميائية الرمزية الموزونة لتفاعل غاز الهيدروجين مع غاز الأكسجين لتكوين بخار الماء." Do NOT put any formula or arrow in the question text. answer = the balanced symbolic equation only, with Unicode subscripts and an arrow. choices = []. Use only reactions that appear in the text or follow directly from it.`,
};
const MATH_STAGE: Record<Stage, string> = {
  primary: "STAGE = primary school. Short sentences, small whole numbers, simple fractions/decimals only as the text shows them. Word problems use everyday situations (money, sweets, school, measurements).",
  prep: "STAGE = preparatory (middle) school. Use the book's own methods: algebra, fractions, ratios, equations, geometry and statistics exactly as the text teaches them.",
  secondary: "STAGE = secondary school. Questions may need multi-step algebra, functions, trigonometry, calculus or statistics as the text teaches them. Use precise mathematical notation.",
};
const MATH_RULES = `- MATH EXCEPTION TO GROUNDING: you MAY (and should) invent NEW numbers, values, names and situations, but ONLY for the topics, rules and question styles that appear in the text. Copy the style and difficulty of the book's examples and exercises. Never use a topic the text does not teach.
- The student has NO book, figure or graph. Describe any shape in words with all its measures (e.g. "مستطيل طوله ٨ سم وعرضه ٥ سم"). Plain text only, in EXACTLY this notation (the sheet draws it as real stacked fractions and roots): fraction 3/4, and with parentheses when the top or bottom has more than one term: (2x + 1)/(x - 3); square root √25 or √(x + 4); cube root ³√27; powers x², x³ (superscript digits) or x^n; multiplication ×, division ÷. The book text uses English digits 0-9 (and Latin letters x, y for unknowns): write every number with English digits 0-9, never Arabic-Indic ٠-٩, unless the text itself clearly uses ٠-٩. Keep the digit style the same inside one question. If a text line shows a fraction as a/b or (a)/(b) or a root as √..., keep that notation.
- ACCURACY IS EVERYTHING: calculate every answer twice. If you are not sure the answer is exactly right, do not write the question. Prefer clean numbers that give tidy results.
- mcq (اختر): a complete math question with exactly 4 choices and exactly one correct. Wrong choices are the results of common student mistakes (wrong sign, forgot a step, wrong operation, wrong unit) and look like the right one (same form and type). No two choices may be equal in value. answer = the exact text of the correct choice.
- fill (أكمل): ONE short complete math statement or exercise in which the result or one missing number / expression (at most two blanks) is replaced by "______", e.g. "3/4 + 1/4 = ______", "إذا كان 2x + 3 = 11 فإن x = ______", "مساحة مستطيل طوله 8 سم وعرضه 5 سم = ______ سم²". The blank is a number, an expression or a unit-less result the student can find by a short calculation, never a linking word. The statement must have exactly one correct answer. choices = []. answer = the missing value(s) in the order of the blanks, separated by " - " (just the value, with its unit only if the blank asks for it).
- solve (أجب عن الأسئلة): a question the student solves on paper. Start with a verb such as احسب / أوجد / حل / بسّط / اختصر / أوجد ناتج / جد. One short problem that asks for ONE final result (a word problem is allowed and may be 2-3 sentences). It must contain the given numbers. choices = []. answer = the worked solution, one step per line (the rule, the substitution, the result), ending with the final answer and its unit if any.`;
// ---------- Arabic / Social studies / English: each subject has its own head, its own general rules and its own wording of every type ----------
const LANG_HEAD: Record<string, string> = {
  arabic: "SUBJECT = Arabic language (اللغة العربية: نصوص، أدب، نحو، صرف، بلاغة، إملاء). Questions must test language skill and understanding, not memorising page layout.",
  social: "SUBJECT = Social studies (الدراسات الاجتماعية: تاريخ، جغرافيا، تربية وطنية). Questions must test knowledge and understanding of the lesson, not page layout.",
  english: "SUBJECT = English language. Write EVERY question, choice and answer in English (even if some book pages are in Arabic), and test English skill: vocabulary, grammar, reading comprehension, language functions.",
};
const LANG_COMMON: Record<string, string[]> = {
  arabic: [
    "- Identify what kind of text each part is (قراءة / نص أدبي / قاعدة نحوية / صرف / بلاغة / إملاء) and write the matching kind of question. Spread the questions over the different skills the text offers: meaning of words (مرادف / ضد / جمع / مفرد), comprehension, the writer's idea, grammar (الإعراب، نوع الجملة، الفاعل، المبتدأ والخبر...), morphology, rhetoric (تشبيه، استعارة، كناية), spelling.",
    "- LANGUAGE EXCEPTION TO GROUNDING: for grammar, morphology, rhetoric and spelling you MAY write NEW example sentences, but ONLY for the rules the text teaches, in the same style and difficulty as the book's examples. Facts about a text (its writer, its idea, its events) must come only from the text.",
    "- The student has NO book. Any question about a passage must QUOTE the needed word, line or sentence inside the question itself (between quotation marks). Never write \"في النص\" / \"في الفقرة\" / \"السطر الثاني\" without quoting.",
    "- Put full diacritics (التشكيل) on the words that grammar, morphology and spelling questions are about, and on any word that could be read in two ways. Write all other text with correct standard Arabic (فصحى), correct hamza / تاء / ألف مقصورة.",
    "- ACCURACY: grammar and rhetoric answers must be exactly right. If you are not sure of the إعراب or the figure of speech, do not write the question.",
  ],
  social: [
    "- Write questions about the real content of the lesson: people, places, dates, events, causes and results, definitions of terms, rights and duties, natural and human features. Spread them over the different parts of the lesson.",
    "- The student has NO book, map, picture or timeline. Never refer to \"الخريطة\" / \"الشكل\" / \"الصورة\" / \"الجدول\". Describe a place by its name and a date as a number in the question when needed.",
    "- NAMES, DATES AND NUMBERS must be copied exactly as the text gives them. Never change a date, a name or a number, and never invent one. If two sources in the text disagree, skip the question.",
    "- Every question names its exact subject (the country, the battle, the ruler, the river, the law...): never \"هذه الدولة\" / \"هذا الحدث\". Add the period or place when the same name could mean two things.",
  ],
  english: [
    "- Questions test English, written in English: vocabulary (meaning, synonym, antonym, odd one out), grammar (tenses, articles, prepositions, comparatives, conditionals, passive, question forms...), reading comprehension, and language functions (greetings, requests, advice, directions...). Match the mix to what the text teaches.",
    "- LANGUAGE EXCEPTION TO GROUNDING: for vocabulary and grammar you MAY write NEW sentences, but ONLY for the words and grammar points the text teaches, at the same level as the book. Facts about a reading passage must come only from the passage.",
    "- The student has NO book. A reading question must put the needed sentence INSIDE the question (quote it) before asking about it. Never write \"according to the text / passage\" without the quoted sentence.",
    "- Use simple, natural, correct English suitable for the grade. Use vocabulary the text uses. No slang, no idioms the book did not teach.",
    "- ACCURACY: every grammar answer must be exactly right. If a sentence could have two correct answers, rewrite it or skip it.",
  ],
};
// the types that are written the same way in every subject (the subject only changes the wording of the question)
const MATCH_RULE = (head: string, what: string) => `- match (${head}): the text is exactly "${head}" and NOTHING else. choices = 4 or 5 pairs, each written "item of column A ||| its match in column B" (${what}). Every pair comes from the text. All items of column A are different, all items of column B are different, and no item of column B could also fit another item of column A. answer = the same pairs, one per line, written "A ← B".`;
// How long and how hard a story is, by the age of the pupils (the age comes from the grade found in the book, see lib/detect.ts)
function storyRule(age: number | null, stage: Stage | null, level: number | null): string {
  const lv = age == null ? "The reader age is UNKNOWN: infer it from the difficulty of the book text (sentence length, vocabulary, grammar) and write the story at that level."
    : age <= 7 ? `READER AGE = ${age} (${stage === "primary" ? `primary ${level ?? ""}` : "young beginner"}). 40-60 words, sentences of at most 8 words, only very common words, simple present or past simple, 3 questions.`
    : age <= 9 ? `READER AGE = ${age}. 60-90 words, short simple sentences (6-10 words), everyday words, 3-4 questions.`
    : age <= 11 ? `READER AGE = ${age}. 90-130 words, simple and compound sentences, everyday words, 4 questions.`
    : age <= 13 ? `READER AGE = ${age}. 120-170 words, some linking words (because, but, so, then, after that), 4 questions.`
    : age <= 15 ? `READER AGE = ${age}. 160-230 words, a clear beginning / problem / ending, richer vocabulary, 4-5 questions.`
    : `READER AGE = ${age}. 200-300 words, varied sentences and tenses, richer vocabulary, 5 questions.`;
  return `- story (Read the story): ONE short ORIGINAL story written by you. It does not have to come from the text, but its vocabulary and grammar must stay inside what the text teaches plus very common words. ${lv}
  Format: "text" = the TITLE on the first line (2-5 words, no full stop), then the story in 1-3 short paragraphs, each on its own line. The story must be complete (a real ending) and suit that age: animals, school, friends, family, nature, helping others, a small mystery. NO violence, romance, politics, religion, brands or real people.
  "choices" = the questions, each written "question ||| short answer" (the answer is at most one sentence). Mix who / what / where / when, why, one true-or-false question (the answer is True or False, the question starts with "True or false:") and, for ages 9+, one question about the meaning of a word from the story. Every answer is found IN the story, the questions follow the order of the story and none repeats another. "answer" = all the answers, one per line, in the same order. Everything is in English.`;
}
const MAP_RULE = `- map (أسئلة الخرائط): the picture sent with this request is a MAP cut from the book. It is printed on the exam right above these questions, so the student SEES it. Write short questions answered by LOOKING at the map: the name written at a number or letter, what is drawn at a sign of the legend, which sea / river / country / city lies north, south, east or west of another, the capital marked on it, what a colour means. Use ONLY names and signs that are clearly readable on the picture or written in the MAP NOTES. If you cannot read a label with certainty, do NOT ask about it. The book's own map questions in the MAP NOTES may be used, written in full. Each question says exactly what is asked and where to look (for example "ما اسم البحر الذي يحد الدولة المشار إليها بالرقم ٣ من الجهة الشمالية؟"), never "ما هذا؟". Never ask the student to draw, colour or mark on the map. choices = []. answer = the short exact answer. No two questions have the same answer.`;
const LANG_KIND_RULES: Record<string, Record<string, string>> = {
  arabic: {
    mcq: "- mcq: for grammar and morphology the three wrong choices are the classic mistakes (another case ending, another part of speech, another form) and look like the right one. For vocabulary the choices are real Arabic words of the same type. Exactly one choice is correct under the rules the text teaches.",
    tf: "- tf: a statement about a rule, a word meaning or the text, fully true or fully false.",
    fill: "- fill (أكمل): ONE complete sentence, verse or rule from the text in which one key word (or the word the rule is about) is replaced by \"______\". The blank is a meaningful word or a grammatical form (never a linking word) and the sentence must make the answer unique. answer = the missing word(s) in the order of the blanks, separated by \" - \".",
    match: MATCH_RULE("صل من العمود ( أ ) ما يناسبه من العمود ( ب ):", "word and meaning, word and opposite, singular and plural, poet and poem, term and definition"),
    order: "- order (رتّب): the text is \"رتّب الكلمات الآتية لتكوّن جملة مفيدة:\" followed by the words of ONE sentence of the text (4 to 9 words) in a scrambled order separated by \" / \". The scrambled order must differ from the original. answer = the correct full sentence. Only sentences with ONE correct order.",
    vocab: "- vocab (مفردات): ONE short question about ONE word of the text, written like \"ما مرادف كلمة ( يرِفّ )؟\" / \"اذكر ضد كلمة ( سعادة )\" / \"اكتب جمع كلمة ( قلم )\" / \"اكتب مفرد كلمة ( كُتُب )\". The word is between brackets with full diacritics; if it has more than one meaning, quote the sentence it appears in. answer = ONE word only (the one the text teaches). Never ask for a word that has several equally correct answers.",
    reason: "- reason (علّل): the text MUST begin with \"علل:\" followed by the COMPLETE true statement to be explained, written inside the question (a rule, a spelling, a line of the text). answer = the cause in 1-2 sentences, taken from the text or from the rule it teaches.",
    essay: "- essay (فهم واستيعاب): a short task such as ما معنى كذا / اشرح بيتًا أو عبارة / ما الفكرة العامة / ما المقصود بقوله / ما نوع الأسلوب / ما الدرس المستفاد. The sentence or line to work on is written inside the question. answer = the full correct answer (1-3 sentences).",
    irab: "- irab (أعرب): the text starts with \"أعرب ما بين القوسين:\" followed by a complete sentence in which 1 or 2 words are written between ( ) and fully voweled, e.g. \"أعرب ما بين القوسين: (الطالبُ) مجتهدٌ.\" Use only the grammar the text teaches. answer = the full إعراب of each word between brackets: its type, its case or mood, and the sign of the case, e.g. \"الطالبُ: مبتدأ مرفوع وعلامة رفعه الضمة الظاهرة\". Each word is parsed in one line.",
    extract: "- extract (استخرج): the text is \"استخرج من الجملة / من البيت الآتي ...\" naming EXACTLY what to extract (فاعلًا، مفعولًا به، حالًا، نعتًا، فعلًا مضارعًا، اسم فاعل، جمع تكسير، كلمة مرادفة لـ ...), and the sentence or line is written inside the question with full diacritics. What is asked for must exist exactly ONCE. answer = the extracted word(s) only.",
    rhetoric: "- rhetoric (بلاغة): the text asks to identify or explain a figure of speech or style in a line written inside the question, e.g. \"وضّح الصورة البلاغية في قول الشاعر: «...»\" / \"ما نوع التشبيه في قولنا: ...؟\" / \"ما نوع الأسلوب في: ...؟\". Only figures the text teaches. answer = the name of the figure and one short explanation (what is compared with what / why). If you are not sure, skip it.",
  },
  social: {
    mcq: "- mcq: the 3 wrong choices are real names, places, dates or terms from the SAME lesson and of the same kind as the right one (e.g. other rulers of the same era, other cities of the same region). Only one is correct.",
    tf: "- tf: a statement that is fully true or fully false. A false statement changes ONE key name, date, place or cause to a believable wrong one taken from the lesson.",
    fill: "- fill (أكمل): ONE complete statement from the text in which one key name, date, place, term or number is replaced by \"______\". The sentence must make the answer unique. answer = the missing word(s) in the order of the blanks, separated by \" - \".",
    match: MATCH_RULE("صل من العمود ( أ ) ما يناسبه من العمود ( ب ):", "event and date, person and achievement, place and feature, term and meaning, country and capital"),
    order: "- order (رتّب): the text is \"رتّب الأحداث الآتية ترتيبًا زمنيًا:\" (or \"... ترتيبًا منطقيًا:\" for the steps of a process) followed by 3 to 5 events of the text, each short but understandable WITHOUT its date, written in a scrambled order separated by \" / \". The scrambled order must differ from the right one. answer = the same events from first to last, joined by \" ← \". Only events whose order the text makes certain.",
    term: "- term (اكتب المصطلح): the text starts with \"اكتب المصطلح:\" followed by ONE complete description taken from the text, WITHOUT the term itself or any word of it. answer = the term only (1-4 words) exactly as the book writes it.",
    define: "- define (عرّف): the text is short: \"عرّف: <term>.\" where the term is a concept the text defines (a term, a treaty, a revolution, a feature...). answer = the book's definition in 1-2 sentences. Never ask to define something the text does not define.",
    reason: "- reason (علّل): the text MUST begin with \"علل:\" followed by the COMPLETE true statement to be explained, written inside the question (e.g. \"علل: ازدهرت الزراعة على ضفاف نهر النيل.\"). The text must give its cause. answer = the cause in 1-2 sentences.",
    compare: "- compare (قارن): the text is \"قارن بين <A> و <B> من حيث <aspect 1> و <aspect 2>.\" Both items and every aspect must be covered by the text. answer = one line per aspect, written \"<aspect>: <A> ... / <B> ...\". Only compare things the text really contrasts.",
    map: MAP_RULE,
    list: "- list (اذكر / عدّد): the text starts with \"اذكر\" or \"عدّد\" and says HOW MANY, e.g. \"اذكر ثلاثة من أسباب قيام ثورة ١٩١٩.\" / \"عدّد مظاهر التنوع في ...\". The number asked is never more than the text lists. answer = the points one per line (all the points the text gives, up to 5).",
  },
  english: {
    mcq: "- mcq: for grammar the wrong choices are the typical learner mistakes (wrong tense, wrong form, wrong preposition) and look like the right one. EXACTLY ONE choice must be correct in the sentence. For vocabulary all choices are real English words of the same kind. Put a blank \"______\" inside the sentence for fill-in-the-blank items.",
    tf: "- tf: a statement about the passage or a language fact, fully true or fully false.",
    fill: "- fill (complete): ONE complete English sentence from the text (or built on its grammar point) in which one word or phrase is replaced by \"______\". The sentence must make the answer unique. If the blank needs a verb, give the base form in brackets after the blank, e.g. \"She ______ (go) to school every day.\" answer = the missing word(s), separated by \" - \" if there are several blanks.",
    match: MATCH_RULE("Match column ( A ) with column ( B ):", "word and meaning, word and opposite, word and picture description, question and answer"),
    order: "- order (put in order): the text is \"Put the words in the correct order to make a sentence:\" followed by the words of ONE sentence of the text (4 to 9 words) in a scrambled order separated by \" / \". The scrambled order must differ from the original and the sentence must have ONE natural correct order. answer = the correct full sentence with a capital letter and a full stop.",
    vocab: "- vocab (vocabulary): ONE short instruction about ONE word of the text, such as \"Write the synonym of ( enormous ).\" / \"Write the opposite of ( ancient ).\" / \"Write the plural of ( child ).\" / \"Write the past tense of ( buy ).\" The word is between brackets. answer = ONE word only. Never ask for a word that has several equally correct answers.",
    essay: "- essay (answer the question): a reading or language question answered in ONE full sentence. The sentence or short paragraph it is about is written INSIDE the question. answer = the correct full-sentence answer.",
    correct: "- correct (correct the mistake): the text is \"Correct the mistake:\" followed by ONE complete sentence that contains exactly ONE clear grammar or spelling mistake of a point the text teaches (wrong tense, wrong verb form, wrong preposition, missing -s, wrong word order...). answer = the whole sentence written correctly. The sentence has only ONE possible correction.",
    rewrite: "- rewrite (rewrite as shown): the text is \"Rewrite the sentence as shown:\" followed by ONE complete sentence and, between brackets, what to do (make it negative / make it a question / use the passive / use reported speech / join with because, but, and / begin with ...). answer = the whole rewritten sentence. The task has ONE correct answer; add the first words (\"Begin with: ...\") when more than one wording is possible.",
  },
};
function subjectRules(subject: string, stage: Stage | null, level: number | null, branch: Branch | null, types: string[], focus: string[] = [], age: number | null = null): string {
  if (subject === "math") {
    const m = ["SUBJECT = Mathematics (رياضيات). Questions must test mathematical skill, not memorising page layout."];
    if (stage) m.push(MATH_STAGE[stage]);
    if (stage && level) m.push(`GRADE = ${GRADE_ORD[level - 1]} ${STAGE_SHORT[stage]}. Match exactly the level of this grade's curriculum; do not use topics or difficulty from higher grades.`);
    else m.push("The school stage is unknown: infer it from the vocabulary and difficulty of the text and write questions at that level.");
    m.push(MATH_RULES);
    return "\n\nSUBJECT RULES:\n" + m.join("\n");
  }
  if (subject === "arabic" || subject === "social" || subject === "english") {
    const m = [LANG_HEAD[subject]];
    if (stage) m.push(`STAGE = ${stage === "primary" ? "primary" : stage === "prep" ? "preparatory (middle)" : "secondary"} school.` + (level ? ` GRADE = ${GRADE_ORD[level - 1]} ${STAGE_SHORT[stage]}.` : "") + " Match exactly the level of this grade; no topics or difficulty from higher grades.");
    else m.push("The school stage is unknown: infer it from the vocabulary and difficulty of the text and write questions at that level.");
    if (focus.length) m.push(`THE CHOSEN PAGES MOSTLY TEACH: ${focus.join(" / ")}. Write the questions from these areas, in proportion to how much of the text each one covers.`);
    m.push(...LANG_COMMON[subject]);
    for (const k of types) { const rule = k === "story" ? storyRule(age, stage, level) : LANG_KIND_RULES[subject][k]; if (rule) m.push(rule); }
    return "\n\nSUBJECT RULES:\n" + m.join("\n");
  }
  if (subject !== "science") return "";
  const parts = ["SUBJECT = Science (علوم). Questions must test scientific understanding, not memorising page layout."];
  if (stage) parts.push(STAGE_RULES[stage]);
  if (stage && level) parts.push(`GRADE = ${GRADE_ORD[level - 1]} ${STAGE_SHORT[stage]}. Match exactly the level of this grade's curriculum; do not use topics or difficulty from higher grades.`);
  else parts.push("The school stage is unknown: infer it from the vocabulary and difficulty of the text and write questions at that level.");
  if (branch && BRANCH_RULES[branch]) parts.push(BRANCH_RULES[branch]);
  for (const k of types) if (KIND_RULES[k]) parts.push(KIND_RULES[k]);
  return "\n\nSUBJECT RULES:\n" + parts.join("\n");
}

// OCR output can contain control characters, private-use symbols and lines of pure noise ("|||", "~ _ .").
// Strip them so Gemini only sees real text.
function cleanText(t: string, math = false): string {
  return t
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uE000-\uF8FF\uFFFD\uFFF0-\uFFFF]/g, " ")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => {
      if (!l) return true;
      const letters = (l.match(/[\p{L}\p{N}]/gu) ?? []).length;
      if (math) return letters >= 2 && letters / l.length >= 0.3; // math lines are full of symbols: "٣ + ٥ = ٨", "(س + ٢)² = ٩"
      return letters >= 3 && letters / l.length >= 0.5;
    })
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

import { cleanOne, type Raw } from "@/lib/cleanQuestion";

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

// Ways to turn "thinking" off, tried in order. Older Flash models use thinkingBudget, Gemini 3 models use thinkingLevel.
const THINKING: Array<Record<string, unknown> | null> = [
  { thinkingBudget: 0 },
  { thinkingLevel: "minimal" },
  { thinkingLevel: "low" },
  null,
];
const thinkingByModel: Record<string, number> = {}; // learned at runtime

export async function POST(req: Request) {
  // only signed-in teachers whose subscription covers this subject may use the AI (and the Gemini key)
  let subjectReq = "";
  let apiKey: string | null = null;
  try {
    const u = await requireUser(req);
    subjectReq = String(((await req.clone().json()) as { subject?: string })?.subject ?? "");
    await assertSubjectAccess(u, subjectReq);
    await chargeTrialBatch(u); // free-trial users have a limited number of AI batches
    apiKey = (await getUserKey(u))?.key ?? null; // THIS teacher's own Gemini key
  } catch (e) {
    if (e instanceof ApiError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.status });
    return NextResponse.json({ code: "bad_request", error: "طلب غير صالح" }, { status: 400 });
  }

  if (!apiKey) return NextResponse.json({ code: "no_key", error: "لم تضف مفتاح Gemini الخاص بك بعد. اضغط زر «🔑 مفتاح الذكاء الاصطناعي» في الأعلى والصق مفتاحك المجاني." }, { status: 400 });
  const key: string = apiKey; // narrowed copy for the closures below

  let body: { context?: string; want?: Record<string, number>; avoid?: string[]; difficulty?: string; topic?: string; subject?: string; stage?: string; level?: number; branch?: string; focus?: string[]; age?: number; maps?: Array<{ id?: string; dataUrl?: string; hint?: string }> };
  try { body = await req.json(); } catch { return NextResponse.json({ code: "bad_request", error: "طلب غير صالح" }, { status: 400 }); }

  const isMath = body.subject === "math";
  const context = cleanText(body.context ?? "", isMath).slice(0, 9000);
  // how many questions of each type to write in this batch (small batches finish well inside the time limit)
  const want: Record<string, number> = {};
  let n = 0;
  for (const k of KINDS) {
    const c = Math.max(0, Math.floor(Number(body.want?.[k]) || 0));
    if (c && n < 8) { want[k] = Math.min(c, 8 - n); n += want[k]; }
  }
  // map questions need the picture: ONE map per request (the client sends it with its notes). Without a valid picture the type is dropped.
  const mapIn = (Array.isArray(body.maps) ? body.maps : []).find((m) => typeof m?.id === "string" && m.id.length <= 60 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(String(m?.dataUrl ?? "")) && String(m.dataUrl).length <= 1_600_000);
  const mapPic = mapIn ? { id: String(mapIn.id), b64: String(mapIn.dataUrl).replace(/^data:image\/jpeg;base64,/, ""), hint: String(mapIn.hint ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").slice(0, 900) } : null;
  if (want.map && (!mapPic || body.subject !== "social")) { n -= want.map; delete want.map; }
  if (want.story && body.subject !== "english") { n -= want.story; delete want.story; }
  if (want.story > 2) { n -= want.story - 2; want.story = 2; }            // a story is long: two per request keep the answer inside the time limit
  if (want.map > 3) { n -= want.map - 3; want.map = 3; }
  const types = Object.keys(want);
  if (context.trim().length < 200 || !types.length) return NextResponse.json({ code: "bad_request", error: "النص قصير جدًا أو لم تُحدَّد أنواع الأسئلة" }, { status: 400 });
  const level = LEVELS[body.difficulty ?? "mixed"] ?? LEVELS.mixed;
  const topic = (body.topic ?? "").trim().slice(0, 200);
  const avoid = (Array.isArray(body.avoid) ? body.avoid : []).map((s) => String(s).replace(/\s+/g, " ").trim().slice(0, 110)).filter(Boolean).slice(-40);
  const NAMES: Record<string, string> = {
    term: body.subject === "science" ? "term (write the scientific term)" : "term (write the term)", define: "define (عرّف)", compare: "compare (قارن)", fill: "fill (complete the blank)", mcq: "mcq (multiple choice)", tf: "tf (true/false)",
    essay: body.subject === "english" ? "essay (answer the question in a full sentence)" : body.subject === "arabic" ? "essay (comprehension: a short written answer)" : "essay (theoretical question)",
    reason: "reason (علل)", problem: "problem (numeric science problem)", solve: "solve (math question the student answers with a worked solution)", balance: "balance (balance a given chemical equation)", write: "write (write a balanced chemical equation from words)",
    match: "match (two columns: choices are 'A ||| B' pairs)", order: body.subject === "social" ? "order (put events in order)" : "order (scramble the words of a sentence)", vocab: "vocab (one word: synonym / opposite / plural / meaning)", list: "list (اذكر / عدّد)",
    story: "story (a short original English story + questions about it)", map: "map (questions answered by looking at the map picture)",
    irab: "irab (parse the words between brackets)", extract: "extract (extract what is asked from a sentence)", rhetoric: "rhetoric (figure of speech / style)", correct: "correct (correct the mistake)", rewrite: "rewrite (rewrite the sentence as shown)",
  };
  const stage = (["primary", "prep", "secondary"] as const).find((x) => x === body.stage) ?? null;
  const gradeNo = Number.isInteger(body.level) && body.level! >= 1 && body.level! <= 6 ? body.level! : null;
  const branch = (Object.keys(BRANCH_LABEL) as Branch[]).find((x) => x === body.branch) ?? null;
  const focus = (Array.isArray(body.focus) ? body.focus : []).map((x) => String(x).replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 6);
  const ageIn = Number.isInteger(body.age) && body.age! >= 5 && body.age! <= 19 ? body.age! : null;
  const age = ageOf(stage, gradeNo) ?? ageIn;          // the grade found in the book decides; the reading-level estimate is the fallback
  const rules = subjectRules(String(body.subject ?? ""), stage, gradeNo, branch, types, focus, age);

  const hints = hintsFor(context, types, String(body.subject ?? "") || undefined);
  const prompt = `${rules ? rules.trim() + "\n\n" : ""}${hints ? hints + "\n" : ""}Write exactly ${n} questions, with exactly this many of each type:
${types.map((k) => `- ${NAMES[k]}: ${want[k]}`).join("\n")}
Difficulty: ${level}.
${topic ? `Focus on this topic: ${topic}\n` : ""}${avoid.length ? `These questions were ALREADY written for other copies of the exam. Do NOT repeat them or ask the same thing in other words; write completely different questions about other facts in the text:\n${avoid.map((s) => `- ${s}`).join("\n")}\n` : ""}
${mapPic ? `MAP NOTES (text printed on the book page around the map; the book's own map questions are here):\n"""\n${mapPic.hint || "(none)"}\n"""\n` : ""}
TEXT:
"""
${context}
"""`;

  const keyId = createHash("sha256").update(key).digest("hex").slice(0, 12);
  await addUsage(keyId); // shared counter (all devices) - only when a database is configured

  const ctrl = new AbortController();
  req.signal.addEventListener("abort", () => ctrl.abort());
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; ctrl.abort(); }, DEADLINE_MS);

  const call = (model: string, thinking: Record<string, unknown> | null, signal: AbortSignal) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }, ...(mapPic && want.map ? [{ inlineData: { mimeType: "image/jpeg", data: mapPic.b64 } }] : [])] }],
        generationConfig: {
          responseMimeType: "application/json", responseSchema: SCHEMA, maxOutputTokens: 6144,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
    });

  // We answer the browser IMMEDIATELY with a stream, then talk to Gemini inside it.
  // Any problem (slow model, rate limit, timeout) is reported as a normal {"t":"err"} line instead of a 504 page.
  const enc = new TextEncoder(), dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: object) => { try { controller.enqueue(enc.encode(JSON.stringify(o) + "\n")); } catch {} };
      send({ t: "hello" }); // first byte right away
      const ext = new ObjectExtractor();
      let count = 0, buf = "";
      try {
        const models = await pickModels(key);
        let lastErr: { code: string; error: string; retryAfter?: number } | null = null;
        let finished = false, dayHits = 0;
        for (let mi = 0; mi < models.length && !finished; mi++) {
          const model = models[mi], last = mi === models.length - 1;
          const mctrl = new AbortController();
          const onAbort = () => mctrl.abort();
          ctrl.signal.addEventListener("abort", onAbort);
          let stalled = false;
          const stallTimer = setTimeout(() => { stalled = true; mctrl.abort(); }, FIRST_OUTPUT_MS);
          try {
            let res: Response;
            let tIdx = thinkingByModel[model] ?? 0;
            for (;;) {
              res = await call(model, THINKING[tIdx], mctrl.signal);
              if (res.status === 400 && THINKING[tIdx] && !/api key/i.test(await res.clone().text())) { tIdx++; continue; } // this model rejects that "thinking off" setting -> try the next way
              break;
            }
            thinkingByModel[model] = tIdx;

            if (!res.ok) {
              let j: unknown = {};
              try { j = await res.json(); } catch {}
              console.error("gemini error", model, res.status, JSON.stringify(j).slice(0, 500));
              const e = classify(res.status, j);
              if (e.code === "rate_day") dayHits++; // each model has its own daily quota: only when EVERY model is out is the key really out
              if (!lastErr || lastErr.code === "error" || e.code !== "error") lastErr = e; // keep the most useful error
              // a bad key will fail on every model; anything else (busy, quota, retired model) -> try the next one
              if (lastErr.code === "bad_key" || last) break;
              continue;
            }

            const reader = res.body!.getReader();
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
                const piece = (j.candidates?.[0]?.content?.parts ?? []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
                if (piece) clearTimeout(stallTimer);
                for (const obj of ext.push(piece)) {
                  let raw: Raw;
                  try { raw = JSON.parse(obj); } catch { continue; }
                  const q = cleanOne(raw, types, isMath, String(body.subject ?? ""));
                  if (q) { if (q.kind === "map" && mapPic) q.mapId = mapPic.id; count++; send({ t: "q", q }); }
                }
              }
            }
            finished = true;
            if (!count) {
              if (last) break;
              finished = false; lastErr = { code: "empty", error: "لم ينجح النموذج في كتابة أسئلة من هذا الجزء من النص" };
              continue;
            }
          } catch (e) {
            if (ctrl.signal.aborted) throw e; // the whole request was stopped or ran out of time
            if (count) { finished = true; break; } // keep what was written
            console.error("gemini stalled/failed", model, stalled ? "no output in time" : String(e));
            lastErr = { code: stalled ? "timeout" : "network", error: stalled ? "استغرق النموذج وقتًا طويلًا" : "تعذّر الاتصال بخدمة الذكاء الاصطناعي", retryAfter: 2 };
            if (last) break;
          } finally {
            clearTimeout(stallTimer);
            ctrl.signal.removeEventListener("abort", onAbort);
          }
        }
        if (count) { send({ t: "done", count }); await clearDayLimit(keyId); } // a model worked -> the key is usable, drop any stale "limit" flag
        else if (lastErr) {
          if (dayHits >= models.length) await markDayLimit(keyId, msUntilPacificMidnight()); // every model is out for today -> every device shows the limit
          send({ t: "err", code: lastErr.code, message: lastErr.error, retryAfter: lastErr.retryAfter });
        } else send({ t: "err", code: "empty", message: "لم ينجح النموذج في كتابة أسئلة من هذا الجزء من النص" });
      } catch {
        if (timedOut) {
          // Keep whatever was already written; only report an error if nothing arrived.
          if (count) send({ t: "done", count });
          else send({ t: "err", code: "timeout", message: "استغرق النموذج وقتًا طويلًا", retryAfter: 2 });
        } else if (!ctrl.signal.aborted) {
          send({ t: "err", code: count ? "stream" : "network", message: count ? "انقطع الاتصال بالنموذج أثناء الكتابة" : "تعذّر الاتصال بخدمة الذكاء الاصطناعي" });
        }
      } finally {
        clearTimeout(deadline);
        try { controller.close(); } catch {}
      }
    },
    cancel() { clearTimeout(deadline); ctrl.abort(); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}
