"use client";
import { useState } from "react";
import { SUBJECTS } from "@/lib/subjects";
import { ALL_DISCOUNT, CURRENCY, LIST_PRICE, PRICE, SUBJECT_COUNT, UNIT_PRICE, entLabel, type OrderDoc, type Plan } from "@/lib/plans";
import { PAY_NUMBER, WHATSAPP_NUMBER } from "@/lib/payment";
import { useAccess } from "@/components/AccessProvider";
import { useAuth } from "@/components/AuthProvider";
import CodeForm from "@/components/CodeForm";

// Two gateways, one after the other:
//   1) OrderStep   - teacher / center name + phone + the subscription (subject or all) with its price -> "إنشاء الاشتراك" places an order.
//   2) PaymentStep - how to pay + the receipt on WhatsApp + the box where the code (sent back by the admin) is entered.
// The step shown is decided by the server: an open order => PaymentStep.
export default function SubscribeFlow({ onDone }: { onDone?: () => void }) {
  const { order } = useAccess();
  return order ? <PaymentStep order={order} onDone={onDone} /> : <OrderStep onDone={onDone} />;
}

const money = (n: number) => `${n} ${CURRENCY}`;

function OrderStep({ onDone }: { onDone?: () => void }) {
  const { profile, createOrder } = useAccess();
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [plan, setPlan] = useState<Plan>("single");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const valid = name.trim().length >= 2 && phone.trim().length >= 8 && (plan === "all" || !!subject);
  const label = plan === "all" ? "كل المواد" : subject ? entLabel(subject as never) : "—";
  const off = Math.round(ALL_DISCOUNT * 100);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setErr("");
    const m = await createOrder({ name, phone, plan, subject: plan === "single" ? subject : undefined });
    setBusy(false);
    if (m) setErr(m);
  };

  return (
    <form className="sub-flow" onSubmit={submit}>
      <h4><span className="step-n2">1</span> بيانات المدرس أو السنتر</h4>
      <div className="field"><label htmlFor="o-name">اسم المدرس أو السنتر</label><input id="o-name" className="input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أ/ أحمد محمد أو سنتر النور" /></div>
      <div className="field"><label htmlFor="o-phone">رقم الهاتف</label><input id="o-phone" className="input" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" /></div>

      <h4><span className="step-n2">2</span> اختر الاشتراك</h4>
      <div className="plan-pick">
        <button type="button" className={`plan-card${plan === "single" ? " sel" : ""}`} aria-pressed={plan === "single"} onClick={() => setPlan("single")}>
          <b>مادة واحدة</b>
          <span className="plan-price">{UNIT_PRICE} <small>{CURRENCY} / شهر</small></span>
          <small>تختار المادة من الأسفل</small>
        </button>
        <button type="button" className={`plan-card${plan === "all" ? " sel" : ""}`} aria-pressed={plan === "all"} onClick={() => setPlan("all")}>
          <span className="plan-tag">خصم {off}%</span>
          <b>كل المواد</b>
          <span className="plan-price"><s className="plan-was">{LIST_PRICE.all}</s> {PRICE.all} <small>{CURRENCY} / شهر</small></span>
          <small>{SUBJECT_COUNT} مواد × {UNIT_PRICE} − {off}%</small>
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

      <div className="order-sum" aria-live="polite">
        <div><span>الاشتراك</span><b>{label}</b></div>
        <div><span>المدة</span><b>30 يومًا</b></div>
        {plan === "all" && <div><span>قبل الخصم</span><s>{money(LIST_PRICE.all)}</s></div>}
        <div className="total"><span>الإجمالي</span><b>{money(PRICE[plan])}</b></div>
      </div>

      {err && <p className="login-err" role="alert">{err}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !valid}>{busy ? "جاري إنشاء الطلب…" : "إنشاء الاشتراك"}</button>
      {plan === "single" && !subject && <p className="hint">اختر المادة لتتمكن من إنشاء الاشتراك.</p>}

      <details className="have-code">
        <summary>لديك كود بالفعل؟</summary>
        <CodeForm onDone={onDone} />
      </details>
    </form>
  );
}

function PaymentStep({ order, onDone }: { order: OrderDoc; onDone?: () => void }) {
  const { cancelOrder } = useAccess();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const label = entLabel(order.subject);
  const text = [
    "مرحبًا، أريد الاشتراك في CenterExam.",
    `رقم الطلب: ${order.ref}`,
    `الاشتراك: ${order.plan === "all" ? "كل المواد" : `مادة واحدة — ${label}`} (${order.price} ${CURRENCY} / شهر)`,
    `الاسم: ${order.name}`,
    `الهاتف: ${order.phone}`,
    `البريد: ${user?.email ?? order.email}`,
    "أرفقت صورة إيصال التحويل.",
  ].join("\n");
  const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;

  const copyNumber = async () => {
    try { await navigator.clipboard.writeText(PAY_NUMBER); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };
  const cancel = async () => {
    if (!confirm("إلغاء هذا الطلب وإنشاء طلب جديد؟")) return;
    setBusy(true); setErr("");
    const m = await cancelOrder();
    setBusy(false);
    if (m) setErr(m);
  };

  return (
    <div className="sub-flow">
      <div className="order-card">
        <div className="order-card-top"><b>طلبك رقم</b><code dir="ltr">#{order.ref}</code></div>
        <div className="order-sum">
          <div><span>الاسم</span><b>{order.name}</b></div>
          <div><span>الهاتف</span><b dir="ltr">{order.phone}</b></div>
          <div><span>الاشتراك</span><b>{label}</b></div>
          <div className="total"><span>المطلوب تحويله</span><b>{money(order.price)}</b></div>
        </div>
        <span className={`pill ${order.status === "code_sent" ? "ok" : ""}`}>{order.status === "code_sent" ? "تم تجهيز كودك — أدخله بالأسفل" : "بانتظار الدفع وإرسال الكود"}</span>
      </div>

      <h4><span className="step-n2">1</span> حوّل المبلغ</h4>
      <div className="pay-box">
        <p className="pay-amount">حوّل <b>{money(order.price)}</b> عبر <b>فودافون كاش</b> أو <b>إنستا باي</b> على الرقم:</p>
        <div className="pay-num">
          <code dir="ltr">{PAY_NUMBER}</code>
          <button type="button" className="btn-ghost" onClick={copyNumber}>{copied ? "تم النسخ ✓" : "نسخ الرقم"}</button>
        </div>
      </div>

      <h4><span className="step-n2">2</span> أرسل صورة التحويل</h4>
      <a className="wa-btn" href={wa} target="_blank" rel="noreferrer">💬 أرسل صورة التحويل على واتساب</a>
      <p className="hint">يفتح واتساب برسالة جاهزة فيها رقم طلبك. أرفق لقطة شاشة التحويل وأرسلها، وسيصلك الكود بعد المراجعة.</p>

      <div className="flow-sep">وصلك الكود؟</div>
      <h4><span className="step-n2">3</span> أدخل كود الاشتراك</h4>
      <CodeForm onDone={onDone} />
      <p className="hint">كود المادة الواحدة يفتح هذه المادة فقط ويُبقي بقية المواد مغلقة، وكود «كل المواد» يفتح كل المواد.</p>

      {err && <p className="login-err" role="alert">{err}</p>}
      {order.status === "pending" && <button type="button" className="btn-ghost order-cancel" onClick={cancel} disabled={busy}>إلغاء الطلب وتغيير الاشتراك</button>}
    </div>
  );
}
