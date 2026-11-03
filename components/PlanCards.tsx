import { CURRENCY, PRICE } from "@/lib/plans";

export default function PlanCards() {
  return (
    <div className="plan-grid">
      <div className="plan-card"><b>مادة واحدة</b><span className="plan-price">{PRICE.single} <small>{CURRENCY} / شهر</small></span><small>تختار المادة عند طلب الكود</small></div>
      <div className="plan-card best"><span className="plan-tag">الأوفر</span><b>كل المواد</b><span className="plan-price">{PRICE.all} <small>{CURRENCY} / شهر</small></span><small>العلوم · العربي · الدراسات · الإنجليزي · الرياضيات</small></div>
    </div>
  );
}
