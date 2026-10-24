"use client";
import { useEffect, useState } from "react";
import type { Exam, Q } from "@/exam";

const KIND: Record<Q["kind"], string> = { mcq: "اختيار من متعدد", tf: "صح وخطأ", essay: "مقالي" };
const isAr = (s: string) => /[\u0600-\u06FF]/.test(s);


// For every version: one button for the student copy (no answers) and one with the answers marked.
function Downloads({ e, onPrint }: { e: Exam; onPrint: (e: Exam, v: string, key: boolean) => void }) {
  const hasKey = e.questions.some((q) => q.answer);
  return (
    <div className="ver-list">
      {e.versions.map((v) => (
        <div key={v} className="ver-row">
          <b className="ver-badge mono">{v}</b>
          <button type="button" className="act-btn" onClick={() => onPrint(e, v, false)} aria-label={`تنزيل النسخة ${v} بدون حل`}>📄 بدون حل</button>
          {hasKey
            ? <button type="button" className="act-btn solved" onClick={() => onPrint(e, v, true)} aria-label={`تنزيل النسخة ${v} مع الحل`}>✅ مع الحل</button>
            : <span className="sub">لا يوجد حل</span>}
        </div>
      ))}
    </div>
  );
}

function Preview({ exam, onClose, onChange, onPrint }: { exam: Exam; onClose: () => void; onChange: (e: Exam) => void; onPrint: (e: Exam, v: string, key: boolean) => void }) {
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={exam.title}>
        <div className="modal-head">
          <div>
            <h3>{exam.title}</h3>
            <p>{exam.questions.length} سؤال{exam.info ? ` · ${exam.info}` : ""}</p>
          </div>
          <button type="button" className="del-row-btn" aria-label="إغلاق" onClick={onClose}>✕</button>
        </div>
        <div className="modal-dl"><Downloads e={exam} onPrint={onPrint} /></div>
        <ol className="modal-body">
          {exam.questions.map((q, i) => (
            <li key={i} className="pv">
              <div className="pv-top">
                <b className="mono">{i + 1}</b><span className="pill">{KIND[q.kind]}</span>
                <button type="button" className="pv-del" onClick={() => onChange({ ...exam, questions: exam.questions.filter((_, k) => k !== i) })}>حذف السؤال</button>
              </div>
              <p dir="auto">{q.text}</p>
              {q.kind === "mcq" && <ul dir="auto">{q.choices.map((c, k) => <li key={k} className={c === q.answer ? "ok" : ""}>{c}</li>)}</ul>}
              {q.kind === "tf" && q.answer && <span className="lq-ans">✓ {q.answer === "true" ? (isAr(q.text) ? "صح" : "True") : isAr(q.text) ? "خطأ" : "False"}</span>}
              {q.kind === "essay" && q.answer && <p className="pv-ans" dir="auto">✓ {q.answer}</p>}
              {q.explanation && <p className="pv-why" dir="auto">{q.explanation}</p>}
            </li>
          ))}
          {!exam.questions.length && <li className="pv-empty">لا توجد أسئلة في هذا الاختبار.</li>}
        </ol>
      </div>
    </div>
  );
}

export default function Library({ exams, loading, onPrint, onDelete, onUpdate }: {
  exams: Exam[]; loading: boolean;
  onPrint: (e: Exam, v: string, key: boolean) => void;
  onDelete: (id: string) => void;
  onUpdate: (e: Exam) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const open = exams.find((e) => e.id === openId) ?? null;

  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(null), 3500); return () => clearTimeout(t); }, [confirm]);

  return (
    <section className="card">
      <div className="card-header"><span className="qch-dot" /> مكتبة الاختبارات المحفوظة <span className="gen-time">{exams.length ? `${exams.length} اختبار` : ""}</span></div>
      <div className="table-wrap">
        <table className="etable">
          <thead><tr><th>الاختبار</th><th>الأسئلة</th><th>تنزيل PDF (بدون حل / مع الحل)</th><th>التاريخ</th><th>إجراءات</th></tr></thead>
          <tbody>
            {exams.length === 0 ? (
              <tr><td colSpan={5} className="empty"><strong>{loading ? "جارٍ تحميل الاختبارات…" : "لا توجد اختبارات بعد"}</strong>{loading ? "" : "كل اختبار تنشئه يُحفظ هنا تلقائيًا ويمكنك طباعته أو تنزيله في أي وقت."}</td></tr>
            ) : exams.map((e) => (
              <tr key={e.id}>
                <td className="strong" data-label="الاختبار">
                  <div>{e.title}</div>
                  {e.info && <div className="sub">{e.info}</div>}
                </td>
                <td className="mono" data-label="الأسئلة">{e.questions.length}</td>
                <td className="dl-cell" data-label="تنزيل PDF">
                  <Downloads e={e} onPrint={onPrint} />
                </td>
                <td className="mono" data-label="التاريخ">{e.date}</td>
                <td className="dl-cell" data-label="إجراءات">
                  <div className="dl-group">
                    <button type="button" className="act-btn" onClick={() => setOpenId(e.id)}>👁 معاينة</button>
                    <button type="button" className={`act-btn danger${confirm === e.id ? " armed" : ""}`}
                      onClick={() => { if (confirm === e.id) { onDelete(e.id); setConfirm(null); } else setConfirm(e.id); }}>
                      {confirm === e.id ? "تأكيد الحذف؟" : "🗑 حذف"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <Preview exam={open} onClose={() => setOpenId(null)} onChange={onUpdate} onPrint={onPrint} />}
    </section>
  );
}
