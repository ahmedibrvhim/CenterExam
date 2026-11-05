// Finds the MAPS (and other drawings) on a page of a book, so they can be cut out of the PDF and printed on the exam
// above the questions that are asked about them.
//
// Pure pixel code (no DOM): it gets the RGBA pixels of a rendered page and returns boxes. The browser part is in lib/mapscan.ts.
//
// How a map is told apart from text:
//   * letters are SMALL separate marks (a few pixels wide) -> everything small is "text"
//   * a map is made of BIG connected shapes (coast lines, borders, colour fills)
//   * frames around a box and the lines of a table are big too, but they are thin straight lines or an empty rectangle -> removed
//   * the big shapes that are close to each other are merged into one box; the labels inside / around it (small marks) are added
//
// It works at a fixed working width (the caller renders the page about 700 px wide).

export type Pix = { data: Uint8ClampedArray | Uint8Array; width: number; height: number }; // RGBA
export type Box = { x: number; y: number; w: number; h: number };

type Comp = { minX: number; minY: number; maxX: number; maxY: number; n: number; edge: number; thin: number };

export function findGraphicRegions(img: Pix, opt: { minAreaPct?: number } = {}): Box[] {
  const { width: W, height: H, data } = img;
  const N = W * H;
  const mask = new Uint8Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (data[p + 3] > 20 && (lum < 215 || sat > 28)) mask[i] = 1;
  }

  // ---- run lengths: a pixel on a thin straight line has a long run in ONE direction and a short one in the other ----
  const hr = new Uint16Array(N), vr = new Uint16Array(N);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!mask[y * W + x]) { x++; continue; }
      let e = x; while (e < W && mask[y * W + e]) e++;
      for (let k = x; k < e; k++) hr[y * W + k] = e - x;
      x = e;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!mask[y * W + x]) { y++; continue; }
      let e = y; while (e < H && mask[e * W + x]) e++;
      for (let k = y; k < e; k++) vr[k * W + x] = e - y;
      y = e;
    }
  }

  // ---- connected components (8 neighbours), two passes with union-find ----
  const label = new Int32Array(N);
  const parent: number[] = [0];
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  let next = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      const nb: number[] = [];
      if (x > 0 && label[i - 1]) nb.push(label[i - 1]);
      if (y > 0) {
        if (label[i - W]) nb.push(label[i - W]);
        if (x > 0 && label[i - W - 1]) nb.push(label[i - W - 1]);
        if (x < W - 1 && label[i - W + 1]) nb.push(label[i - W + 1]);
      }
      if (!nb.length) { label[i] = next; parent.push(next); next++; }
      else { const m = Math.min(...nb); label[i] = m; for (const v of nb) union(m, v); }
    }
  }
  const comps = new Map<number, Comp>();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!label[i]) continue;
    const id = find(label[i]); label[i] = id;
    const c = comps.get(id);
    if (!c) comps.set(id, { minX: x, minY: y, maxX: x, maxY: y, n: 1, edge: 0, thin: 0 });
    else { if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y; c.n++; }
  }
  // second look at every pixel of the BIG components: how many sit on the border of their box (a frame), how many are thin straight lines (a table)
  const SMALL = Math.max(28, Math.round(W * 0.045));
  const isBig = (c: Comp) => c.maxX - c.minX + 1 > SMALL || c.maxY - c.minY + 1 > SMALL;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!label[i]) continue;
    const c = comps.get(label[i])!; if (!isBig(c)) continue;
    if (x - c.minX < 4 || c.maxX - x < 4 || y - c.minY < 4 || c.maxY - y < 4) c.edge++;
    if ((hr[i] >= 40 && vr[i] <= 4) || (vr[i] >= 40 && hr[i] <= 4)) c.thin++;
  }

  const pageArea = W * H;
  const big: Box[] = [], small: Box[] = [];
  for (const c of comps.values()) {
    const w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
    const box = { x: c.minX, y: c.minY, w, h };
    if (!isBig(c)) { small.push(box); continue; }
    if (Math.min(w, h) < 10) continue;                            // a rule / underline
    if (w * h > pageArea * 0.85) continue;                        // the border of the scan
    if (c.n < w * h * 0.12 && c.edge / c.n > 0.8) continue;       // an empty frame around a box (its content stays)
    if (c.thin / c.n > 0.6) continue;                             // the grid of a table
    big.push(box);
  }

  // ---- merge the big shapes that touch or are close to each other, then add the labels that belong to them ----
  const pad = Math.round(W * 0.03);
  const grow = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const join = (a: Box, b: Box): Box => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
  let groups = big.slice();
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      if (hit(grow(groups[i], pad), grow(groups[j], pad))) { groups[i] = join(groups[i], groups[j]); groups.splice(j, 1); changed = true; break outer; }
    }
  }
  // labels (small marks) are only taken when they lie INSIDE the shape or just touch its edge: a paragraph that ends right above the map must stay out
  const tol = Math.max(6, Math.round(W * 0.01));
  groups = groups.map((g) => {
    let out = g; const area = grow(g, tol);
    for (const s of small) if (s.x >= area.x && s.y >= area.y && s.x + s.w <= area.x + area.w && s.y + s.h <= area.y + area.h) out = join(out, s);
    return out;
  });

  // a block of TEXT (or dotted answer lines) can also form one big shape: it has empty bands between its lines and little ink,
  // a map / photo is inked all the way down. Such a box is dropped.
  const looksLikeText = (g: Box): boolean => {
    const x0 = Math.max(0, g.x), y0 = Math.max(0, g.y), x1 = Math.min(W, g.x + g.w), y1 = Math.min(H, g.y + g.h);
    if (x1 - x0 < 1 || y1 - y0 < 1) return false;
    let ink = 0, blank = 0;
    for (let y = y0; y < y1; y++) {
      let row = 0;
      for (let x = x0; x < x1; x++) if (mask[y * W + x]) { row++; }
      ink += row; if (row === 0) blank++;
    }
    const rows = y1 - y0, area = (x1 - x0) * rows;
    return blank / rows > 0.18 && ink / area < 0.3;
  };

  const minArea = pageArea * ((opt.minAreaPct ?? 2.5) / 100);   // a map photo printed small (about 4% of the page) must still be found
  return groups
    .filter((g) => g.w * g.h >= minArea && g.w >= W * 0.2 && g.h >= H * 0.08 && !looksLikeText(g))
    .sort((a, b) => b.w * b.h - a.w * a.h);
}

// the words that tell a page has a map on it (spelling variants are normalised the same way as lib/analyze.ts)
export const MAP_WORDS = /(?:خريط|خرايط|اطلس|map\b|maps\b|atlas)/i;
export const hasMapWord = (text: string): boolean => MAP_WORDS.test(text.normalize("NFKC").replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه"));

// The lines of the page text that talk about the map: they are given to the AI together with the picture
// (the book's own map questions are usually right there: "حدد على الخريطة ...", "ما اسم البحر الذي ...؟").
export function mapHint(text: string, max = 700): string {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    if (hasMapWord(l)) { for (let k = Math.max(0, i - 1); k <= Math.min(lines.length - 1, i + 3); k++) keep.add(k); }
    else if (/[؟?]\s*$/.test(l) && l.length > 12) keep.add(i);
  });
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n").slice(0, max);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The book's OWN questions about a map, copied from the text of the page (no AI): they are printed on the exam under the map.
//   "ادرس الخريطة ثم أجب عما يأتي:  ١- ما اسم البحر الذي يحد مصر من الشمال؟  ٢- حدد موقع ..."
// A question is taken when it names the map itself, or when it follows a line that tells the student to study the map.
// ---------------------------------------------------------------------------------------------------------------------------
const BULLET = /^\s*(?:\(?[0-9٠-٩]{1,2}\s*[-–.)\]]|\([0-9٠-٩]{1,2}\)|[أ-ي]\s*[-–.)])\s*/;
const Q_WORD = /^(?:حدد|اذكر|اكتب|عدد|عين|بين|وضح|استخرج|قارن|ما|ماذا|من|اين|اي|كم|لماذا|كيف|هل|ضع|ارسم|لون|اختر|علل|فسر|سجل|استنتج|اكمل|صف|ظلل|املا|اكتشف|ماهي|ماهو)(?=\s|$)/;
const plain = (t: string) => t.normalize("NFKC").replace(/[ً-ٟـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
const letters = (t: string) => (t.match(/\p{L}/gu) ?? []).length;

// ---------------------------------------------------------------------------------------------------------------------------
// LABEL-STYLE map questions (the usual Egyptian exam format):
//     أمامك خريطة لحوض النيل، من خلالها أجب عما يأتي:
//     (١) خزان ..................
//     (٢) أحد روافد نهر النيل ..................
//     (٣) دولة قامت بها حضارة أكسوم ..................
// The numbers are drawn ON the map picture; the student writes what each number is. These items are short (no verb, no question mark),
// so the generic reader below used to drop them and the AI was left to guess. They are turned into full questions here.
// Works on OCR text too: OCR often misreads the digits ("(٢)" -> "(7)") and glues junk after the dots, so the number is taken from the ORDER
// of the items, not from the digit that was read, and everything after the dotted line is thrown away.
// ---------------------------------------------------------------------------------------------------------------------------
const LEADER = /(?:\.{4,}|…{2,}|_{4,}|[.…_·]{5,})/;
const NUM_BULLET = /^[\s\u200e\u200f\u202a-\u202e]*[()\[\]]?\s*[0-9٠-٩]{1,2}\s*[()\[\].\-–]/;
const NUM_BULLET_OCR = /^[\s\u200e\u200f\u202a-\u202e]*[()\[\]]\s*[^\p{L}\s]{1,2}\s*[()\[\]]/u;         // \"(”)\"  \")9(\"  : a bracketed junk character that OCR read instead of a digit
const LETTER_BULLET = /^[\s\u200e\u200f\u202a-\u202e]*[()]?\s*[أ-ي]\s*[()\-–.]/;                           // \"(ب)\" : the next part of the exam starts: the map block is over
function labelDesc(line: string): string {
  let t = line.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "");
  const m = t.search(LEADER);
  if (m >= 0) t = t.slice(0, m);
  t = t.replace(/^[^\p{L}]+/u, "");                                   // the bullet, whatever way it was read
  t = t.replace(/\s[0-9٠-٩>|<~=\-–_]+(?:\s.*)?$/u, "");               // junk glued after the words ("أكسوم 0 1 > جحي")
  return t.replace(/[\s:：،,;؛]+$/u, "").replace(/\s+/g, " ").trim();
}
const ASK_WORDS = new Set(["ما", "ماذا", "من", "اين", "كم", "اذكر", "اكتب", "حدد", "عدد", "عين", "بين", "وضح", "هل", "كيف", "لماذا", "ضع", "صف", "استخرج"]);
export function extractLabelBlock(text: string): { at: number; items: string[] } | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!hasMapWord(l) || !(/[:：]/.test(l) || /(?:اجب|أجب)/.test(plain(l)) || /^[\s\d()٠-٩]*(?:ادرس|لاحظ|تامل|تأمل|انظر|بالرجوع|بالاعتماد|بالاستعانة)/.test(plain(l)))) continue;
    const items: Array<{ d: string; leader: boolean }> = [];
    for (let j = i + 1, miss = 0; j < lines.length && items.length < 8; j++) {
      const raw = lines[j];
      if (!raw.trim()) continue;
      const leader = LEADER.test(raw);
      if (LETTER_BULLET.test(raw) && !leader) break;                                // "(ب) اكتب ما تشير ..." ends the block
      const isItem = leader || NUM_BULLET.test(raw) || NUM_BULLET_OCR.test(raw);
      const d = isItem ? labelDesc(raw) : "";
      // a label is a SHORT noun phrase: no brackets left inside it, no full stop, not a sentence, not a question
      const ok = isItem && letters(d) >= 3 && d.length <= 45 && d.split(" ").length <= 7 && !/[()\[\]]/.test(d) && !/[.؟?]$/.test(d) && !ASK_WORDS.has(plain(d).split(" ")[0] ?? "");
      if (!ok) { if (isItem && items.length >= 2) break; if (++miss > 1) break; continue; }   // one noise line (text read from inside the picture) is tolerated
      miss = 0;
      items.push({ d, leader });
    }
    // a real label list has dotted lines for the answers: without them a numbered list is ordinary questions (the generic reader below takes those)
    const withLeader = items.filter((x) => x.leader).length;
    if (items.length < 2 || withLeader < 2 || withLeader * 2 < items.length) continue;
    return { at: i, items: items.map((x) => x.d) };                                // the first map block of the page is enough
  }
  return null;
}

export function extractMapQuestions(text: string): string[] {
  const lines = text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => letters(l) >= 2 && !/^[0-9٠-٩\s.\-–]+$/.test(l));
  // lines -> items: a numbered line starts a new item; other lines continue the item above until it ends with . ؟ ? : !
  const items: Array<{ t: string; bullet: boolean }> = [];
  for (const l of lines) {
    const bullet = BULLET.test(l);
    const prev = items[items.length - 1];
    if (!prev || bullet || /[؟?.:!؛]$/.test(prev.t)) items.push({ t: l.replace(BULLET, "").trim(), bullet });
    else prev.t += " " + l;
  }
  const isQ = (t: string) => /[؟?]\s*$/.test(t) || Q_WORD.test(plain(t));
  const out: string[] = [];
  const add = (t: string) => {
    const x = t.replace(/\s+/g, " ").trim();
    if (letters(x) < 10 || x.length > 320) return;
    if (/(?:صفحة|ص)\s*[0-9٠-٩]+/.test(x)) return;                  // "انظر صفحة ٤٥": the student has no book on the exam
    if (!out.some((o) => plain(o) === plain(x))) out.push(x);
  };
  items.forEach((it, i) => {
    if (!hasMapWord(it.t)) return;
    const intro = /[:：]\s*$/.test(it.t) || /(?:ثم\s*)?(?:اجب|أجب)/.test(plain(it.t)) || /^(?:ادرس|لاحظ|تامل|تأمل|انظر|اقرا|اقرأ|بالرجوع|بالاعتماد|بالاستعانة)/.test(plain(it.t));
    if (isQ(it.t) && !intro) { add(it.t); return; }
    if (intro) {
      // the numbered questions right under "ادرس الخريطة ثم أجب" belong to the map
      for (let j = i + 1, taken = 0; j < items.length && taken < 8; j++) {
        const n = items[j];
        if (!n.bullet && !isQ(n.t)) break;
        if (isQ(n.t) || (n.bullet && letters(n.t) >= 10)) { add(n.t); taken++; }
      }
      if (isQ(it.t) && /[؟?]\s*$/.test(it.t)) add(it.t);
    }
  });
  return out.slice(0, 8);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The WHOLE question set of one map, as the exam prints it under the picture:
//   (أ) أمامك خريطة ... من خلالها أجب عما يأتي:          a = ["خزان", "أحد روافد نهر النيل", ...]   (the numbers are drawn on the map)
//   (ب) اكتب ما تشير إليه كل عبارة مما يأتي:              b = ["أحد منابع نهر النيل ويقع في وسط إفريقيا.", ...]
// Only what the BOOK PAGE really asks is taken: nothing is invented. A map whose page has no questions has an empty set (and is not used).
// ---------------------------------------------------------------------------------------------------------------------------
export type MapSet = { a: string[]; b: string[] };
const PART_B_INTRO = /(?:تشير|اكتب ما|ما تشير|ما يشير)/;
const NEW_PART = /(?:اختر|ماذا|ما المقصود|قارن|علل|اكمل|اكمل|صوب|ما النتائج|عرف|رتب|صل)/;
export function extractMapSet(text: string): MapSet {
  const lines = text.split("\n");
  const blk = extractLabelBlock(text);
  let a: string[] = [];
  let from = 0;
  if (blk) { a = blk.items.slice(0, 8); from = blk.at + 1; }
  else a = extractMapQuestions(text).slice(0, 6);                                   // an ordinary page: the questions the book asks about its map
  // part B: "اكتب ما تشير إليه كل عبارة ..." followed by numbered statements, until the next part of the page
  const b: string[] = [];
  for (let i = from; i < lines.length; i++) {
    const l = lines[i];
    if (!PART_B_INTRO.test(plain(l)) || !/(?:كل عبار|عبار)/.test(plain(l))) continue;
    for (let j = i + 1, miss = 0; j < lines.length && b.length < 8; j++) {
      const raw = lines[j];
      if (!raw.trim()) continue;
      if (LETTER_BULLET.test(raw) || NEW_PART.test(plain(raw).slice(0, 40))) break;
      if (!(NUM_BULLET.test(raw) || NUM_BULLET_OCR.test(raw))) { if (++miss > 0 && b.length) break; continue; }
      const t = raw.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").replace(/^[^\p{L}]+/u, "").replace(/\s+/g, " ").trim();
      if (letters(t) >= 8 && t.length <= 160 && !b.includes(t)) b.push(t);
    }
    break;
  }
  return { a, b };
}

// Tesseract's most common Arabic slip on these pages: a dotted ي read as ب before ق / ر / ة ("إفربقيا", "وبقع", "المصربة"). Used ONLY on text read by Tesseract.
export const fixOcrYa = (t: string): string =>
  t.replace(/إفرب/g, "إفري").replace(/ربق/g, "ريق").replace(/(^|\s)وبقع/g, "$1ويقع").replace(/(^|\s)(ال)?مصرب/g, "$1$2مصري").replace(/(^|\s)يقع/g, "$1يقع");
