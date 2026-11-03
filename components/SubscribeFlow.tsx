"use client";
import { useState } from "react";
import { SUBJECTS } from "@/lib/subjects";
import { CURRENCY, SUBJECT_COUNT, TERMS, TERM_LABEL, TERM_LENGTH, TERM_UNIT, discountPct, entLabel, isPaidTerm, listPriceOf, priceOf, termOf, type OrderDoc, type PaidTerm, type Plan, type Term } from "@/lib/plans";
import { PAY_NUMBER, WHATSAPP_NUMBER } from "@/lib/payment";
import { useAccess } from "@/components/AccessProvider";
import { useAuth } from "@/components/AuthProvider";
import CodeForm from "@/components/CodeForm";

// Two gateways, one after the other:
//   1) OrderStep   - teacher / center name + phone + the term (monthly / yearly / forever / free trial) + the subscription (subject or all) with its price.
//                    Paid terms: "إنشاء الاشتراك" places an order. Free trial: starts at once (ends after the first PDF, all subjects, one time per user), no order.
//   2) PaymentStep - how to pay + the receipt on WhatsApp + the box where the code (sent back by the admin) is entered.
// The step shown is decided by the server: an open order => PaymentStep.
export default function SubscribeFlow({ onDone, subject }: { onDone?: () => void; subject?: string | null }) {
  const { order } = useAccess();
  return order ? <PaymentStep order={order} onDone={onDone} /> : <OrderStep onDone={onDone} fixed={subject ?? null} />;
}

const money = (n: number) => `${n} ${CURRENCY}`;

const TERM_NOTE: Record<Term, string> = { month: "30 يومًا", year: "365 يومًا", forever: "بدون انتهاء", trial: "ملف PDF واحد" };
const TERM_ICON: Record<Term, string> = { month: "📅", year: "🗓️", forever: "♾️", trial: "🎁" };

function OrderStep({ onDone, fixed }: { onDone?: () => void; fixed: string | null }) {
  const { profile, createOrder, startTrial, trialAvailable, trialUsed } = useAccess();
  const [name, setName] = useState(profile?.name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [term, setTerm] = useState<Term>("month");
  const [plan, setPlan] = useState<Plan>("single");
  const [subject, setSubject] = useState(fixed ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const trial = term === "trial";
  const paid: PaidTerm = isPaidTerm(term) ? term : "month";   // the price table the plan cards show (the trial has no plan cards)
  const info = name.trim().length >= 2 && phone.trim().length >= 8;
  const valid = info && (trial ? trialAvailable : plan === "all" || !!subject);
  const label = plan === "all" ? "كل المواد" : subject ? entLabel(subject as never) : "—";
  const off = discountPct(paid);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setErr("");
    const m = trial ? await startTrial(name, phone) : await createOrder({ name, phone, plan, term: paid, subject: plan === "single" ? subject : undefined });
    setBusy(false);
    if (m) setErr(m); else if (trial) onDone?.();
  };

  return (
    <form className="sub-flow" onSubmit={submit}>
      <h4><span className="step-n2">1</span> بيانات المدرس أو السنتر</h4>
      <div className="field"><label htmlFor="o-name">اسم المدرس أو السنتر</label><input id="o-name" className="input" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: أ/ أحمد محمد أو سنتر النور" /></div>
      <div className="field"><label htmlFor="o-phone">رقم الهاتف</label><input id="o-phone" className="input" dir="ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678" /></div>

      <h4><span className="step-n2">2</span> اختر مدة الاشتراك</h4>
      <fieldset className="term-pick">
        <legend className="sr-only">مدة الاشتراك</legend>
        {TERMS.map((t) => {
          const locked = t === "trial" && !trialAvailable;
          return (
            <label key={t} className={`term-opt${term === t ? " sel" : ""}${locked ? " off" : ""}${t === "trial" ? " free" : ""}`}>
              <input type="radio" name="term" value={t} className="sr-only" checked={term === t} disabled={locked} onChange={() => { setTerm(t); setErr(""); }} />
              <span className="term-ico" aria-hidden="true">{TERM_ICON[t]}</span>
              <b>{TERM_LABEL[t]}</b>
              <small>{locked ? (trialUsed ? "استُخدمت من قبل" : "للجدد فقط") : TERM_NOTE[t]}</small>
            </label>
          );
        })}
      </fieldset>

      {trial ? (
        <>
          <div className="trial-box">
            <b>🎁 جرّب مجانًا: ملف PDF واحد</b>
            <ul>
              <li>تفتح <b>كل المواد</b> ({SUBJECT_COUNT} مواد) بدون دفع ولا كود.</li>
              <li>تنتهي بعد تنزيل <b>أول ملف PDF</b> (ملف واحد فقط من أي مادة).</li>
              <li><b>مرة واحدة فقط</b> لكل مستخدم — بعدها تشترك شهريًا أو سنويًا أو دائمًا.</li>
            </ul>
          </div>
          {!trialAvailable && <p className="hint">{trialUsed ? "لقد استخدمت التجربة المجانية من قبل. اختر اشتراكًا مدفوعًا للمتابعة." : "التجربة المجانية متاحة للمستخدمين الجدد فقط."}</p>}
        </>
      ) : (
        <>
          <h4><span className="step-n2">3</span> اختر الاشتراك</h4>
          <div className="plan-pick">
            <button type="button" className={`plan-card${plan === "single" ? " sel" : ""}`} aria-pressed={plan === "single"} onClick={() => setPlan("single")}>
              <b>{fixed ? entLabel(fixed as never) : "مادة واحدة"}</b>
              <span className="plan-price">{priceOf(paid, "single")} <small>{CURRENCY} {TERM_UNIT[paid]}</small></span>
              <small>{fixed ? "هذه المادة فقط" : "تختار المادة من الأسفل"}</small>
            </button>
            <button type="button" className={`plan-card${plan === "all" ? " sel" : ""}`} aria-pressed={plan === "all"} onClick={() => setPlan("all")}>
              <span className="plan-tag">خصم {off}%</span>
              <b>كل المواد</b>
              <span className="plan-price"><s className="plan-was">{listPriceOf(paid, "all")}</s> {priceOf(paid, "all")} <small>{CURRENCY} {TERM_UNIT[paid]}</small></span>
              <small>{SUBJECT_COUNT} مواد · وفّر {off}%</small>
            </button>
          </div>

          {plan === "single" && !fixed && (
            <div className="subj-pick" role="radiogroup" aria-label="المادة">
              {SUBJECTS.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={subject === s.id} className={`subj-chip${subject === s.id ? " sel" : ""}`} onClick={() => setSubject(s.id)}>
                  <span aria-hidden="true">{s.icon}</span> {s.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="order-sum" aria-live="polite">
        <div><span>الاشتراك</span><b>{trial ? "كل المواد" : label}</b></div>
        <div><span>النوع</span><b>{TERM_LABEL[term]}</b></div>
        <div><span>المدة</span><b>{TERM_LENGTH[term]}</b></div>
        {!trial && plan === "all" && <div><span>قبل الخصم</span><s>{money(listPriceOf(paid, "all"))}</s></div>}
        <div className="total"><span>الإجمالي</span><b>{trial ? "مجانًا" : money(priceOf(paid, plan))}</b></div>
      </div>

      {err && <p className="login-err" role="alert">{err}</p>}
      <button type="submit" className="btn-primary" disabled={busy || !valid}>
        {busy ? (trial ? "جاري تفعيل التجربة…" : "جاري إنشاء الطلب…") : trial ? "ابدأ التجربة المجانية" : "إنشاء الاشتراك"}
      </button>
      {!trial && plan === "single" && !subject && <p className="hint">اختر المادة لتتمكن من إنشاء الاشتراك.</p>}
      {trial && trialAvailable && !info && <p className="hint">اكتب الاسم ورقم الهاتف لبدء التجربة.</p>}
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
  const term = termOf(order);
  const text = [
    "مرحبًا، أريد الاشتراك في CenterExam.",
    `رقم الطلب: ${order.ref}`,
    `الاشتراك: ${order.plan === "all" ? "كل المواد" : `مادة واحدة — ${label}`} — ${TERM_LABEL[term]} (${order.price} ${CURRENCY} ${TERM_UNIT[term]})`,
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
          <div><span>النوع</span><b>{TERM_LABEL[term]} · {TERM_LENGTH[term]}</b></div>
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
      <p className="hint">كود المادة الواحدة يفتح هذه المادة فقط ويُبقي بقية المواد مغلقة، وكود «كل المواد» يفتح كل المواد.{term === "forever" && " الاشتراك الدائم لا ينتهي أبدًا."}</p>

      {err && <p className="login-err" role="alert">{err}</p>}
      {order.status === "pending" && <button type="button" className="btn-ghost order-cancel" onClick={cancel} disabled={busy}>إلغاء الطلب وتغيير الاشتراك</button>}
    </div>
  );
}
