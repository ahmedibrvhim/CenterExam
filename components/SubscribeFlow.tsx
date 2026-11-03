"use client";
import { useState } from "react";
import { SUBJECTS } from "@/lib/subjects";
import { CURRENCY, PRICE, entLabel, type EntKey, type Plan } from "@/lib/plans";
import { PAY_NUMBER, WHATSAPP_NUMBER } from "@/lib/payment";
import { useAccess } from "@/components/AccessProvider";
import { useAuth } from "@/components/AuthProvider";
import CodeForm from "@/components/CodeForm";

// 1) choose the plan (and the subject) -> 2) pay by Vodafone Cash / InstaPay -> 3) send the receipt on WhatsApp -> 4) enter the code the admin sends back.
export default function SubscribeFlow({ onDone }: { onDone?: () => void }) {
  const { profile } = useAccess();
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan>("single");
  const [subject, setSubject] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const price = PRICE[plan];
  const ready = plan === "all" || !!subject;
  const label = plan === "all" ? "كل المواد" : subject ? entLabel(subject as EntKey) : "";

  const text = [
    "مرحبًا، أريد الاشتراك في CenterExam.",
    `الاشتراك: ${plan === "all" ? "كل المواد" : `مادة واحدة — ${label}`} (${price} ${CURRENCY} / شهر)`,
    `الاسم: ${profile?.name ?? ""}`,
    `الهاتف: ${profile?.phone ?? ""}`,
    `البريد: ${user?.email ?? ""}`,
    "أرفقت صورة إيصال التحويل.",
  ].join("\n");
  const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

  const copyNumber = async () => {
    try { await navigator.clipboard.writeText(PAY_NUMBER); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  return (
    <div className="sub-flow">
      <h4><span className="step-n2">1</span> اختر الاشتراك</h4>
      <div className="plan-pick">
        <button type="button" className={`plan-card${plan === "single" ? " sel" : ""}`} aria-pressed={plan === "single"} onClick={() => setPlan("single")}>
          <b>مادة واحدة</b><span className="plan-price">{PRICE.single} <small>{CURRENCY} / شهر</small></span><small>تختار المادة من الأسفل</small>
        </button>
        <button type="button" className={`plan-card${plan === "all" ? " sel" : ""}`} aria-pressed={plan === "all"} onClick={() => setPlan("all")}>
          <span className="plan-tag">الأوفر</span><b>كل المواد</b><span className="plan-price">{PRICE.all} <small>{CURRENCY} / شهر</small></span><small>جميع المواد المتاحة</small>
        </button>
      </div>

      {plan === "single" && (
        <div className="subj-pick" role="radiogroup" aria-label="المادة">
          {SUBJECTS.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={subject === s.id} className={`subj-chip${subject === s.id ? " sel" : ""}`} onClick={() => setSubject(s.id)}>
              <span aria-hidden="true">{s.icon}</span> {s.name}
            </button>
          ))}
        </div>
      )}

      {!ready ? <p className="hint">اختر المادة لتظهر لك طريقة الدفع.</p> : (
        <>
          <h4><span className="step-n2">2</span> حوّل المبلغ</h4>
          <div className="pay-box">
            <p className="pay-amount">حوّل <b>{price} {CURRENCY}</b> عبر <b>فودافون كاش</b> أو <b>إنستا باي</b> على الرقم:</p>
            <div className="pay-num">
              <code dir="ltr">{PAY_NUMBER}</code>
              <button type="button" className="btn-ghost" onClick={copyNumber}>{copied ? "تم النسخ ✓" : "نسخ الرقم"}</button>
            </div>
          </div>

          <h4><span className="step-n2">3</span> أرسل صورة التحويل</h4>
          <a className="wa-btn" href={wa} target="_blank" rel="noreferrer">💬 أرسل صورة التحويل على واتساب</a>
          <p className="hint">يفتح واتساب برسالة جاهزة (اسمك ورقمك والاشتراك). أرفق لقطة شاشة التحويل وأرسلها، وسيصلك الكود بعد المراجعة.</p>
        </>
      )}

      <div className="flow-sep">لديك كود؟</div>
      <h4><span className="step-n2">4</span> أدخل كود الاشتراك</h4>
      <CodeForm onDone={onDone} />
    </div>
  );
}
