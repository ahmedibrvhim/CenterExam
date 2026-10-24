"use client";
import { useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import AiStatus from "@/components/AiStatus";
import GenerationPanel, { Gen } from "@/components/GenerationPanel";
import Library from "@/components/Library";
import { Chunk, Exam, OcrError, Q, chunkPages, extractPages, isBlankPage, ocrPages, parseQuestions, pickChunks, printExam, rng, shuffle } from "@/exam";
import { listExams, removeExam, saveExam } from "@/lib/db";
import { Fail, streamBatch } from "@/lib/ai";
import { Limit, fmtDuration, getLimit, getUsage, msUntilPacificMidnight, recordRequest, saveLimit } from "@/lib/limits";

type SrcFile = { id: string; name: string; size: number; file: File; pages?: string[] };
type ToastState = { msg: string; kind: "success" | "error" | "info" } | null;

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const TYPES = [["mcq", "اختيار من متعدد"], ["tf", "صح وخطأ"], ["essay", "مقالي"]] as const;
const DIFFS = [["mixed", "متنوع"], ["easy", "سهل"], ["medium", "متوسط"], ["hard", "صعب"]] as const;
const MAX_MB = 50;
const MAX_OCR_PAGES = 40; // scanned pages read per exam (keeps within the free AI limits)

const fmtSize = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const stripPdf = (n: string) => n.replace(/\.pdf$/i, "");
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const normQ = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// Wait `ms`, but stop immediately (and throw) if the user presses Stop.
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error("aborted")); };
    signal.addEventListener("abort", onAbort, { once: true });
  });

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)}>
      <span className="track" />{label}
    </button>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const genRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<SrcFile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loadingDb, setLoadingDb] = useState(true);
  const [running, setRunning] = useState(false);
  const [gen, setGen] = useState<Gen | null>(null);
  const [limit, setLimit] = useState<Limit>(null);
  const [usage, setUsage] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [title, setTitle] = useState("");
  const [count, setCount] = useState(20);
  const [types, setTypes] = useState<string[]>([]);
  const [versions, setVersions] = useState(1);
  const [shuffleQ, setShuffleQ] = useState(false);
  const [shuffleA, setShuffleA] = useState(false);
  const [mode, setMode] = useState<"ai" | "extract">("ai");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("mixed");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const notify = (msg: string, kind: "success" | "error" | "info" = "info") => {
    setToast({ msg, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3800);
  };

  // load saved exams + remembered daily limit when the page opens
  useEffect(() => {
    setLimit(getLimit());
    setUsage(getUsage());
    listExams().then(setExams).catch(() => notify("تعذّر فتح قاعدة البيانات المحلية (قد يكون المتصفح في وضع التصفح الخفي)", "error")).finally(() => setLoadingDb(false));
    try { navigator.storage?.persist?.(); } catch {} // ask the browser not to delete our data when disk space is low
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const ok: SrcFile[] = [];
    for (const f of Array.from(list)) {
      const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) { notify(`«${f.name}» ليس ملف PDF`, "error"); continue; }
      if (f.size > MAX_MB * 1048576) { notify(`«${f.name}» أكبر من ${MAX_MB} ميجابايت`, "error"); continue; }
      ok.push({ id: crypto.randomUUID(), name: f.name, size: f.size, file: f });
    }
    if (!ok.length) return;
    setFiles((p) => [...p, ...ok]);
    setSelected((s) => [...s, ...ok.map((f) => f.id)]);
    for (const f of ok) {
      extractPages(f.file)
        .then((pages) => setFiles((p) => p.map((x) => (x.id === f.id ? { ...x, pages } : x))))
        .catch(() => { notify(`تعذّرت قراءة «${f.name}»`, "error"); setFiles((p) => p.filter((x) => x.id !== f.id)); setSelected((s) => s.filter((x) => x !== f.id)); });
    }
    if (!title) setTitle(stripPdf(ok[0].name));
    notify(`تم رفع ${ok.length} ملف`, "success");
  };

  const removeFile = (id: string) => {
    setFiles((p) => p.filter((f) => f.id !== id));
    setSelected((s) => s.filter((x) => x !== id));
  };
  const toggleFile = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const toggleType = (k: string) => setTypes((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const chosen = files.filter((f) => selected.includes(f.id));
  const ready = chosen.length > 0 && chosen.every((f) => f.pages);
  const dayLimited = !!limit && limit.kind === "day" && limit.until > Date.now() && mode === "ai";
  const canGenerate = ready && types.length > 0 && !running && !dayLimited;
  const single = chosen.length === 1 && chosen[0].pages ? chosen[0] : null;
  const nPages = single?.pages?.length ?? 0;
  const pFrom = clamp(parseInt(rangeFrom) || 1, 1, Math.max(1, nPages));
  const pTo = clamp(parseInt(rangeTo) || nPages, pFrom, Math.max(1, nPages));

  // build the exam object, show it, and save it to the browser database
  const addExam = async (questions: Q[], seed: number, info: string) => {
    const e: Exam = {
      id: crypto.randomUUID(), title: title.trim() || stripPdf(chosen[0].name), sources: chosen.map((f) => f.name),
      questions, versions: LETTERS.slice(0, versions), seed, shuffleQ, shuffleA,
      date: new Date().toLocaleDateString("ar-EG"), createdAt: Date.now(), info,
    };
    setExams((p) => [e, ...p]);
    try { await saveExam(e); } catch { notify("تعذّر الحفظ الدائم — الاختبار متاح حتى إغلاق الصفحة فقط", "error"); }
  };

  // Mode 1: pick up questions that already exist (numbered) in the PDF
  const generateExtract = async () => {
    const seed = Math.floor(Math.random() * 1e9);
    const usable = chosen.flatMap((f) => parseQuestions(f.pages!.join("\n"))).filter((q) => types.includes(q.kind));
    if (!usable.length) { notify("لم أجد أسئلة مرقّمة من الأنواع المختارة في الملفات", "error"); return; }
    const questions = shuffle(usable, rng(seed)).slice(0, count);
    notify(questions.length < count ? `وجدت ${questions.length} سؤالًا فقط من ${count}` : "تم إنشاء الاختبار وحفظه", questions.length < count ? "info" : "success");
    await addExam(questions, seed, "أسئلة مستخرجة من الملف");
  };

  // Mode 2: the AI writes new questions; they appear on screen one by one
  const generateAI = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const startedAt = Date.now();

    // Step 0: scanned pages (pictures without text) are read by the AI first
    const pagesOf: Record<string, string[]> = {};
    for (const f of chosen) pagesOf[f.id] = [...f.pages!];
    let todo = chosen.flatMap((f) => {
      const [a, b] = single ? [pFrom, pTo] : [1, f.pages!.length];
      const nums: number[] = [];
      for (let p = a; p <= b; p++) if (isBlankPage(f.pages![p - 1])) nums.push(p);
      return nums.length ? [{ f, nums }] : [];
    });
    const blankTotal = todo.reduce((n, t) => n + t.nums.length, 0);
    const nonBlank = chosen.reduce((n, f) => n + f.pages!.filter((t) => !isBlankPage(t)).length, 0);
    if (blankTotal > 0 && blankTotal >= nonBlank) {
      let budget = MAX_OCR_PAGES;
      todo = todo.map((t) => { const nums = t.nums.slice(0, Math.max(0, budget)); budget -= nums.length; return { f: t.f, nums }; }).filter((t) => t.nums.length);
      const total = todo.reduce((n, t) => n + t.nums.length, 0);
      let done = 0;
      const show = (message: string) => setGen({ phase: "writing", batch: 0, batches: 1, target: count, qs: [], startedAt, message });
      show(`الملف ممسوح ضوئيًا — جارٍ قراءة ${total} صفحة بالذكاء الاصطناعي…`);
      setTimeout(() => genRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      try {
        for (const t of todo) {
          const base = done;
          const res = await ocrPages(t.f.file, t.nums, ctrl.signal, {
            onRequest: () => setUsage(recordRequest()),
            onProgress: (d) => show(`جارٍ قراءة الصفحات الممسوحة: ${base + d} من ${total}…`),
            onWait: (s) => show(`وصلنا حد الطلبات في الدقيقة — سنكمل خلال ${s} ثانية…`),
          });
          done += t.nums.length;
          for (const [n, txt] of Object.entries(res)) pagesOf[t.f.id][Number(n) - 1] = txt;
          setFiles((p) => p.map((x) => (x.id === t.f.id ? { ...x, pages: pagesOf[t.f.id] } : x))); // remember, so a second exam doesn't re-read
        }
      } catch (err) {
        abortRef.current = null;
        const stopped = ctrl.signal.aborted;
        if (err instanceof OcrError && err.code === "rate_day") {
          const l: Limit = { kind: "day", until: Date.now() + msUntilPacificMidnight() };
          saveLimit(l); setLimit(l);
        }
        setGen({ phase: stopped ? "stopped" : "failed", batch: 0, batches: 1, target: count, qs: [], startedAt, endedAt: Date.now(), message: stopped ? "تم الإيقاف." : err instanceof OcrError ? err.message : "تعذّرت قراءة الصفحات الممسوحة. حاول مرة أخرى." });
        return;
      }
    }

    const all: Chunk[] = chosen.flatMap((f) => (single ? chunkPages(pagesOf[f.id], pFrom, pTo) : chunkPages(pagesOf[f.id])));
    if (all.reduce((n, c) => n + c.text.length, 0) < 400) {
      abortRef.current = null; setGen(null);
      notify("لم أجد نصًا كافيًا في الصفحات المحددة", "error"); return;
    }
    const picked = pickChunks(all, topic, clamp(Math.ceil(count / 2), 2, 20));
    if (!picked.length) { notify(`لم أجد الموضوع «${topic}» في الصفحات المحددة`, "error"); return; }
    const groups: Chunk[][] = [];
    for (let i = 0; i < picked.length; i += 2) groups.push(picked.slice(i, i + 2));
    const per = Math.min(15, Math.ceil(count / groups.length) + 1); // +1: a little spare in case some questions are rejected

    const got: Q[] = [], seen = new Set<string>();
    setGen({ phase: "writing", batch: 1, batches: groups.length, target: count, qs: [], startedAt });
    setTimeout(() => genRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);

    const push = (q: Q) => {
      const k = normQ(q.text);
      if (seen.has(k) || got.length >= count) return;
      seen.add(k); got.push(q);
      setGen((g) => (g ? { ...g, qs: [...got] } : g));
    };

    let end: { phase: Gen["phase"]; message?: string } = { phase: "done" };
    outer: for (let i = 0; i < groups.length && got.length < count; i++) {
      setGen((g) => (g ? { ...g, batch: i + 1 } : g));
      for (let attempt = 0; ; attempt++) {
        setUsage(recordRequest());
        let fail: Fail | null;
        try {
          fail = await streamBatch({ context: groups[i].map((c) => c.text).join("\n\n"), n: per, types, difficulty, topic: topic.trim() }, ctrl.signal, push);
        } catch {
          if (ctrl.signal.aborted) { end = { phase: "stopped" }; break outer; }
          fail = { code: "network", message: "تعذّر الاتصال بالخادم. تأكد أن التطبيق ما زال يعمل." };
        }
        if (!fail) break;

        if (fail.code === "rate_day") {
          const l: Limit = { kind: "day", until: Date.now() + msUntilPacificMidnight() };
          saveLimit(l); setLimit(l);
          end = { phase: "partial", message: `انتهى الحد اليومي المجاني للذكاء الاصطناعي. يتجدد بعد ${fmtDuration(l.until - Date.now())} تقريبًا.` };
          break outer;
        }
        if ((fail.code === "rate_minute" || fail.code === "busy") && attempt < 3) {
          const secs = clamp(fail.retryAfter ?? 20, 5, 90);
          setLimit({ kind: fail.code === "busy" ? "busy" : "minute", until: Date.now() + secs * 1000 });
          try { await sleep(secs * 1000, ctrl.signal); } catch { end = { phase: "stopped" }; setLimit(getLimit()); break outer; }
          setLimit(getLimit());
          continue;
        }
        end = { phase: "partial", message: fail.message };
        break outer;
      }
    }
    setLimit(getLimit());
    abortRef.current = null;

    // finish: save whatever we have
    const endedAt = Date.now();
    if (!got.length) {
      const stopped = end.phase === "stopped";
      setGen({ phase: stopped ? "stopped" : "failed", batch: 0, batches: groups.length, target: count, qs: [], startedAt, endedAt, message: stopped ? "تم الإيقاف قبل كتابة أي سؤال." : end.message || "لم يستطع الذكاء الاصطناعي كتابة أسئلة من هذا النص. جرّب صفحات أخرى أو موضوعًا مختلفًا." });
      return;
    }
    const info = `ذكاء اصطناعي · ${single ? `ص ${pFrom}–${pTo}` : "كل الصفحات"}${topic.trim() ? ` · ${topic.trim()}` : ""} · ${DIFFS.find(([k]) => k === difficulty)?.[1]}`;
    await addExam(got, Math.floor(Math.random() * 1e9), info);
    if (end.phase === "stopped") end.message = `تم الإيقاف وحفظ ${got.length} سؤالًا في المكتبة.`;
    else if (end.phase === "partial") end.message = `${end.message} — تم حفظ ${got.length} سؤالًا من ${count} في المكتبة.`;
    else if (got.length < count) end.message = `كتب الذكاء الاصطناعي ${got.length} سؤالًا فقط من ${count} لأن النص لا يحتوي مادة كافية. تم حفظها في المكتبة.`;
    else end.message = "تم إنشاء الاختبار وحفظه في المكتبة. يمكنك تنزيله من الأسفل.";
    setGen({ phase: end.phase, batch: groups.length, batches: groups.length, target: count, qs: got, startedAt, endedAt, message: end.message });
  };

  const generate = async () => {
    setRunning(true);
    try {
      if (mode === "ai") await generateAI(); else await generateExtract();
    } catch {
      notify("حدث خطأ أثناء إنشاء الاختبار", "error");
    } finally {
      setRunning(false);
    }
  };

  const download = (e: Exam, v: string, key: boolean) => {
    printExam(e, v, key);
    notify("في نافذة الطباعة اختر «حفظ كملف PDF»", "info");
  };
  const del = async (id: string) => {
    setExams((p) => p.filter((e) => e.id !== id));
    try { await removeExam(id); notify("تم حذف الاختبار", "success"); } catch { notify("تعذّر الحذف من قاعدة البيانات", "error"); }
  };
  const update = async (e: Exam) => {
    setExams((p) => p.map((x) => (x.id === e.id ? e : x)));
    try { await saveExam(e); } catch { notify("تعذّر حفظ التعديل", "error"); }
  };

  const totalVersions = exams.reduce((n, e) => n + e.versions.length, 0);
  const totalQuestions = exams.reduce((n, e) => n + e.questions.length, 0);

  return (
    <>
      <Header />
      <main className="main-content">
        <div className="page-title">
          <h2>مولّد الاختبارات</h2>
          <p>ارفع كتابًا بصيغة PDF، اختر الصفحات والموضوع، ويكتب الذكاء الاصطناعي الأسئلة أمامك وتُحفظ تلقائيًا لتنزّلها في أي وقت.</p>
        </div>

        <section className="stats-grid" aria-label="ملخص">
          <div className="stat-tile"><div><div className="st-num">{files.length}</div><div className="st-label">ملفات PDF</div></div><div className="st-icon">📄</div></div>
          <div className="stat-tile green"><div><div className="st-num">{exams.length}</div><div className="st-label">اختبارات محفوظة</div></div><div className="st-icon">📝</div></div>
          <div className="stat-tile amber"><div><div className="st-num">{totalVersions}</div><div className="st-label">نسخ جاهزة</div></div><div className="st-icon">🗂️</div></div>
          <div className="stat-tile teal"><div><div className="st-num">{totalQuestions}</div><div className="st-label">أسئلة مولّدة</div></div><div className="st-icon">❓</div></div>
        </section>

        <div className="workspace">
          <div className="col">
            <section className="card">
              <div className="card-header"><span className="qch-dot" /> ملفات المصدر</div>
              <div className="card-body">
                <button type="button" className={`dropzone${dragging ? " over" : ""}`}
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
                  <span className="dz-icon">📄</span>
                  <strong>ارفع ملفات PDF</strong>
                  <span>اضغط للاختيار أو اسحب الملفات هنا — حتى {MAX_MB} ميجابايت للملف</span>
                </button>
                <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                {files.length > 0 && (
                  <ul className="file-list">
                    {files.map((f) => (
                      <li key={f.id} className="file-row">
                        <label>
                          <input type="checkbox" checked={selected.includes(f.id)} onChange={() => toggleFile(f.id)} />
                          <span className="fr-name" dir="auto">{f.name}</span>
                        </label>
                        <span className="fr-size">{f.pages ? `${f.pages.length} ص · ${f.pages.some(isBlankPage) && f.pages.filter(isBlankPage).length > f.pages.length / 2 ? "ممسوح ضوئيًا (يُقرأ بالذكاء الاصطناعي) · " : ""}` : "جارٍ القراءة… · "}{fmtSize(f.size)}</span>
                        <button type="button" className="del-row-btn" aria-label={`حذف ${f.name}`} onClick={() => removeFile(f.id)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            {gen && (
              <div ref={genRef}>
                <GenerationPanel gen={gen} limit={limit} onStop={() => abortRef.current?.abort()} onClose={() => setGen(null)} />
              </div>
            )}
          </div>

          <section className="card">
            <div className="card-header"><span className="qch-dot" /> إعدادات الاختبار</div>
            <div className="form">
              <fieldset className="field">
                <legend>طريقة الإنشاء</legend>
                <div className="chips">
                  <button type="button" className="chip" aria-pressed={mode === "ai"} onClick={() => setMode("ai")}>✨ الذكاء الاصطناعي يكتب أسئلة جديدة</button>
                  <button type="button" className="chip" aria-pressed={mode === "extract"} onClick={() => setMode("extract")}>استخراج أسئلة موجودة في الملف</button>
                </div>
              </fieldset>
              {mode === "ai" && <AiStatus limit={limit} usage={usage} />}
              <div className="row2">
                <div className="field">
                  <label htmlFor="title">اسم الاختبار</label>
                  <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: امتحان الوحدة الثانية" />
                </div>
                <div className="field">
                  <label htmlFor="count">عدد الأسئلة</label>
                  <input id="count" type="number" min={5} max={100} className="input mono" value={count}
                    onChange={(e) => setCount(clamp(Number(e.target.value) || 5, 5, 100))} />
                </div>
              </div>
              <fieldset className="field">
                <legend>أنواع الأسئلة</legend>
                <div className="chips">
                  {TYPES.map(([k, l]) => (
                    <button key={k} type="button" className="chip" aria-pressed={types.includes(k)} onClick={() => toggleType(k)}>{l}</button>
                  ))}
                </div>
              </fieldset>
              {mode === "ai" && (
                <>
                  <div className="field">
                    <label htmlFor="topic">الموضوع أو الفصل (اختياري)</label>
                    <input id="topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثال: الانقسام الخلوي — اتركه فارغًا لتغطية الصفحات كلها" />
                  </div>
                  {single && (
                    <div className="field">
                      <label>الصفحات (من 1 إلى {nPages})</label>
                      <div className="range">
                        <input className="input mono" type="number" min={1} max={nPages} inputMode="numeric" placeholder="من" aria-label="من صفحة" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                        <input className="input mono" type="number" min={1} max={nPages} inputMode="numeric" placeholder="إلى" aria-label="إلى صفحة" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                      </div>
                    </div>
                  )}
                  <fieldset className="field">
                    <legend>مستوى الصعوبة</legend>
                    <div className="chips">
                      {DIFFS.map(([k, l]) => (
                        <button key={k} type="button" className="chip" aria-pressed={difficulty === k} onClick={() => setDifficulty(k)}>{l}</button>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <fieldset className="field">
                <legend>عدد النسخ</legend>
                <div className="chips six">
                  {LETTERS.map((l, i) => (
                    <button key={l} type="button" className="chip mono" aria-pressed={i < versions} aria-label={`${i + 1} نسخ`} onClick={() => setVersions(i + 1)}>{l}</button>
                  ))}
                </div>
              </fieldset>
              <div className="switches">
                <Switch on={shuffleQ} onChange={setShuffleQ} label="ترتيب الأسئلة مختلف في كل نسخة" />
                <Switch on={shuffleA} onChange={setShuffleA} label="ترتيب الإجابات مختلف في كل نسخة" />
              </div>
              <button type="button" className="btn-primary" disabled={!canGenerate} onClick={generate}>
                {running ? "جارٍ الإنشاء…" : (mode === "ai" ? "✨ اكتب الأسئلة" : "إنشاء الاختبار") + ` (${versions} ${versions === 1 ? "نسخة" : "نسخ"})`}
              </button>
              {dayLimited && <p className="hint">انتهى الحد اليومي المجاني. يمكنك استخدام «استخراج أسئلة موجودة» أو طباعة اختباراتك المحفوظة الآن.</p>}
              {chosen.length > 0 && !ready && <p className="hint">جارٍ قراءة الملفات…</p>}
              {!chosen.length && <p className="hint">ارفع ملف PDF واحدًا على الأقل وحدّده ليبدأ الإنشاء.</p>}
              {chosen.length > 0 && !types.length && <p className="hint">اختر نوع أسئلة واحدًا على الأقل.</p>}
              {chosen.length > 1 && <p className="hint">سيُسحب الاختبار من {chosen.length} ملفات معًا.</p>}
            </div>
          </section>
        </div>

        <Library exams={exams} loading={loadingDb} onPrint={download} onDelete={del} onUpdate={update} />
      </main>
      <div className="toast-wrap" role="status" aria-live="polite">{toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}</div>
    </>
  );
}
