"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccess } from "@/components/AccessProvider";
import { authFetch } from "@/lib/authFetch";
import { SUBJECTS } from "@/lib/subjects";
import { CURRENCY, ORDER_STATUS_LABEL, PRICE, daysLeft, entLabel, formatCode, isActive, isOpenOrder, type CodeDoc, type OrderDoc, type Plan, type UserDoc } from "@/lib/plans";

type Overview = { now: number; codes: CodeDoc[]; users: UserDoc[]; orders: OrderDoc[]; warning?: string };
const fmt = (t?: number) => (t ? new Date(t).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" }) : "—");
const STATUS: Record<CodeDoc["status"], string> = { unused: "غير مستخدم", used: "مستخدم", revoked: "ملغي" };

async function api(url: string, method: string, body?: object): Promise<{ ok: boolean; data: any }> {
  try {
    const r = await authFetch(url, { method, cache: "no-store", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { error: `رد غير متوقع من الخادم (HTTP ${r.status}). افتح Vercel ← Logs لمعرفة السبب.` }; }
    if (!r.ok && !data.error) data.error = `فشل الطلب (HTTP ${r.status}).`;
    if (!r.ok) data.error = `${data.error}${data.code ? ` [${data.code}]` : ""} — HTTP ${r.status}`;
    return { ok: r.ok, data };
  } catch (e) { return { ok: false, data: { error: `تعذّر الاتصال بالخادم (${(e as Error)?.message || "network"}).` } }; }
}
const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => {});
const waTo = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "").replace(/^0/, "20")}`;
const waCode = (phone: string, c: CodeDoc, ref?: string) => `${waTo(phone)}?text=${encodeURIComponent(`كود اشتراك CenterExam${ref ? ` (طلب #${ref})` : ""} — ${entLabel(c.subject)} — 30 يومًا:\n${formatCode(c.id)}\nافتح الموقع وسجّل الدخول ثم أدخل الكود.`)}`;
const codeLine = (c: CodeDoc) => `${formatCode(c.id)} — ${entLabel(c.subject)} — ${c.price} ${CURRENCY}`;

export default function AdminPage() {
  const { isAdmin } = useAccess();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"orders" | "codes" | "users">("orders");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { ok, data } = await api("/api/admin/overview", "GET");
    if (!ok) { setErr(data.error || "تعذّر تحميل البيانات."); return; }
    setErr(""); setData(data);
  }, []);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  if (!isAdmin) return (
    <main className="main-content"><div className="page-title"><h2>هذه الصفحة للمدير فقط</h2><p><a href="/" className="btn-ghost">العودة للأداة</a></p></div></main>
  );

  return (
    <main className="main-content admin" dir="rtl">
      <div className="page-title admin-head">
        <div><h2>لوحة الإدارة</h2><p>كل بيانات العميل تصلك من طلبه. تأكد من التحويل ثم اضغط «إنشاء كود» وأرسله له، أو احذف الطلب.</p></div>
        <a href="/" className="btn-ghost">‹ الأداة</a>
      </div>
      {err && <p className="login-err" role="alert">{err}</p>}
      {data?.warning && <p className="login-err" role="alert">{data.warning}</p>}
      {data && <Stats d={data} />}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "on" : ""} onClick={() => setTab("orders")}>الطلبات{!!data && data.orders.some((o) => o.status === "pending") && <span className="tab-badge">{data.orders.filter((o) => o.status === "pending").length}</span>}</button>
        <button role="tab" aria-selected={tab === "codes"} className={tab === "codes" ? "on" : ""} onClick={() => setTab("codes")}>الأكواد ({data?.codes.length ?? 0})</button>
        <button role="tab" aria-selected={tab === "users"} className={tab === "users" ? "on" : ""} onClick={() => setTab("users")}>المشتركون ({data?.users.length ?? 0})</button>
      </div>
      {data && tab === "orders" && <Orders d={data} reload={load} flash={flash} />}
      {data && tab === "codes" && <><Generator onDone={load} flash={flash} /><Codes d={data} reload={load} flash={flash} /></>}
      {data && tab === "users" && <Users d={data} reload={load} flash={flash} />}
      {msg && <div className="toast-wrap"><div className="toast success">{msg}</div></div>}
    </main>
  );
}

function Stats({ d }: { d: Overview }) {
  const used = d.codes.filter((c) => c.status === "used");
  const monthAgo = d.now - 30 * 86_400_000;
  const active = d.users.filter((u) => u.entitlements.some((e) => isActive(e, d.now))).length;
  const tiles: [string, string][] = [
    ["طلبات بانتظار الكود", String(d.orders.filter((o) => o.status === "pending").length)],
    ["مشتركون فعّالون", String(active)],
    ["أكواد غير مستخدمة", String(d.codes.filter((c) => c.status === "unused").length)],
    ["إيراد آخر 30 يومًا", `${used.filter((c) => (c.usedAt ?? 0) > monthAgo).reduce((n, c) => n + c.price, 0)} ${CURRENCY}`],
    ["إجمالي الإيراد", `${used.reduce((n, c) => n + c.price, 0)} ${CURRENCY}`],
  ];
  return <section className="stats-grid">{tiles.map(([l, v]) => <div key={l} className="stat-tile"><div><div className="st-num">{v}</div><div className="st-label">{l}</div></div></div>)}</section>;
}

type OrderFilter = "open" | OrderDoc["status"] | "all";
const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString("ar-EG", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

function Orders({ d, reload, flash }: { d: Overview; reload: () => void; flash: (m: string) => void }) {
  const [f, setF] = useState<OrderFilter>("open");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const count = (k: OrderFilter) => d.orders.filter((o) => (k === "all" ? true : k === "open" ? isOpenOrder(o) : o.status === k)).length;
  const rows = useMemo(() => d.orders.filter((o) => (f === "all" || (f === "open" ? isOpenOrder(o) : o.status === f)) && (!q || `${o.ref} ${o.name} ${o.phone} ${o.email}`.toLowerCase().includes(q.toLowerCase()))), [d.orders, f, q]);
  const codeOf = (o: OrderDoc) => (o.codeId ? d.codes.find((c) => c.id === o.codeId) : undefined);
  const userOf = (o: OrderDoc) => d.users.find((u) => u.uid === o.uid);

  // one click: creates the code from the order (subject / price / customer all come from the order) and copies it
  const makeCode = async (o: OrderDoc) => {
    setBusy(o.id);
    const { ok, data } = await api("/api/admin/codes", "POST", { orderId: o.id });
    setBusy("");
    if (!ok) { alert(data.error || "تعذّر إنشاء الكود."); return; }
    const c: CodeDoc = data.codes[0];
    copy(formatCode(c.id)); flash(`تم إنشاء الكود ${formatCode(c.id)} ونسخه`); reload();
  };
  const act = async (o: OrderDoc, action: "cancel" | "delete") => {
    const msg = action === "delete"
      ? (o.status === "activated" ? "حذف سجل هذا الطلب نهائيًا؟ (اشتراك العميل الفعّال لن يتأثر)" : "حذف هذا الطلب نهائيًا؟" + (o.codeId ? " وسيُحذف الكود الخاص به أيضًا." : ""))
      : "إلغاء هذا الطلب؟" + (o.codeId ? " وسيُلغى الكود الخاص به." : "");
    if (!confirm(msg)) return;
    setBusy(o.id);
    const { ok, data } = await api("/api/admin/orders", "PATCH", { id: o.id, action });
    setBusy("");
    if (!ok) { alert(data.error || "فشل الإجراء"); return; }
    flash(action === "delete" ? "تم الحذف" : "تم الإلغاء"); reload();
  };
  const FILTERS: [OrderFilter, string][] = [["open", "المفتوحة"], ["pending", "جديدة"], ["code_sent", "تم إرسال الكود"], ["activated", "مُفعّلة"], ["cancelled", "ملغية"], ["all", "الكل"]];

  return (
    <section className="panel">
      <div className="ord-filters" role="group" aria-label="تصفية الطلبات">
        {FILTERS.map(([k, l]) => <button key={k} type="button" className={f === k ? "on" : ""} onClick={() => setF(k)}>{l} ({count(k)})</button>)}
      </div>
      <div className="filters" style={{ marginBottom: 12 }}>
        <input className="input" placeholder="بحث برقم الطلب أو الاسم أو الهاتف أو البريد" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ord-list">
        {rows.map((o) => {
          const c = codeOf(o);
          const u = userOf(o);
          const current = (u?.entitlements ?? []).filter((e) => isActive(e, d.now));
          return (
            <article key={o.id} className={`ord-card${o.status === "pending" ? " is-pending" : ""}`}>
              <div className="ord-head">
                <div><code dir="ltr">#{o.ref}</code> <small>{fmtTime(o.createdAt)}</small></div>
                <span className={`pill ${o.status === "activated" ? "ok" : o.status === "cancelled" ? "bad" : o.status === "pending" ? "warn" : ""}`}>{ORDER_STATUS_LABEL[o.status]}</span>
              </div>
              <dl className="ord-fields">
                <div><dt>الاسم (مدرس / سنتر)</dt><dd>{o.name}</dd></div>
                <div><dt>رقم الهاتف</dt><dd dir="ltr" style={{ textAlign: "end" }}>{o.phone}</dd></div>
                <div><dt>البريد (حساب Google)</dt><dd dir="ltr" style={{ textAlign: "end" }}>{o.email || "—"}</dd></div>
                <div><dt>الاشتراك المطلوب</dt><dd>{o.plan === "all" ? "كل المواد" : `مادة واحدة — ${entLabel(o.subject)}`}<small>{o.days} يومًا</small></dd></div>
                <div><dt>المبلغ المطلوب</dt><dd>{o.price} {CURRENCY}{o.plan === "all" && o.listPrice > o.price && <small>بدل {o.listPrice} (خصم {Math.round((1 - o.price / o.listPrice) * 100)}%)</small>}</dd></div>
                <div><dt>اشتراكه الحالي</dt><dd>{current.length ? current.map((e) => `${entLabel(e.subject)} (${daysLeft(e, d.now)} يوم)`).join("، ") : "لا يوجد"}</dd></div>
                {c && <div><dt>الكود</dt><dd><code dir="ltr">{formatCode(c.id)}</code><small>{c.status === "used" ? `استُخدم ${fmtTime(c.usedAt)}` : c.status === "revoked" ? "ملغي" : `أُنشئ ${fmtTime(c.createdAt)}`}</small></dd></div>}
                {o.status === "activated" && <div><dt>تاريخ التفعيل</dt><dd>{fmtTime(o.activatedAt)}</dd></div>}
              </dl>
              <div className="ord-actions">
                {o.status === "pending" && <button className="btn-primary" disabled={busy === o.id} onClick={() => makeCode(o)}>{busy === o.id ? "…" : "إنشاء كود"}</button>}
                {c && o.status === "code_sent" && <button className="btn-ghost" onClick={() => { copy(formatCode(c.id)); flash("تم نسخ الكود"); }}>نسخ الكود</button>}
                {c && o.status === "code_sent" && <a className="btn-ghost" href={waCode(o.phone, c, o.ref)} target="_blank" rel="noreferrer">إرسال الكود واتساب</a>}
                <a className="btn-ghost" href={waTo(o.phone)} target="_blank" rel="noreferrer">واتساب العميل</a>
                <a className="btn-ghost" href={`tel:${o.phone}`}>اتصال</a>
                {isOpenOrder(o) && <button className="btn-ghost" disabled={busy === o.id} onClick={() => act(o, "cancel")}>إلغاء</button>}
                <button className="btn-ghost btn-danger" disabled={busy === o.id} onClick={() => act(o, "delete")}>حذف الطلب</button>
              </div>
            </article>
          );
        })}
        {!rows.length && <p className="empty hint" style={{ textAlign: "center", padding: 24 }}>لا توجد طلبات هنا</p>}
      </div>
    </section>
  );
}

function Generator({ onDone, flash }: { onDone: () => void; flash: (m: string) => void }) {
  const [plan, setPlan] = useState<Plan>("single");
  const [subject, setSubject] = useState<string>(SUBJECTS[0].id);
  const [qty, setQty] = useState(1);
  const [cName, setCName] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<CodeDoc[]>([]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { ok, data } = await api("/api/admin/codes", "POST", { plan, subject: plan === "single" ? subject : undefined, quantity: qty, customerName: cName, customerPhone: cPhone, note });
    setBusy(false);
    if (!ok) { setErr(data.error || "تعذّر إنشاء الكود."); return; }
    setMade(data.codes); onDone(); flash(`تم إنشاء ${data.codes.length} كود`);
  };
  const wa = (c: CodeDoc[]) => `https://wa.me/${cPhone.replace(/\D/g, "").replace(/^0/, "20")}?text=${encodeURIComponent(`كود اشتراك CenterExam (${entLabel(c[0].subject)} — 30 يومًا):\n${c.map((x) => formatCode(x.id)).join("\n")}\nافتح الموقع وسجّل الدخول ثم أدخل الكود.`)}`;

  return (
    <section className="panel">
      <h3>إنشاء كود يدوي (بدون طلب)</h3>
      <form className="gen-form" onSubmit={submit}>
        <div className="field"><label>نوع الاشتراك</label>
          <select className="input" value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            <option value="single">مادة واحدة — {PRICE.single} {CURRENCY}</option>
            <option value="all">كل المواد — {PRICE.all} {CURRENCY}</option>
          </select></div>
        {plan === "single" && <div className="field"><label>المادة</label>
          <select className="input" value={subject} onChange={(e) => setSubject(e.target.value)}>{SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
        <div className="field"><label>عدد الأكواد</label><input className="input" type="number" min={1} max={50} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></div>
        <div className="field"><label>اسم العميل (اختياري)</label><input className="input" value={cName} onChange={(e) => setCName(e.target.value)} /></div>
        <div className="field"><label>هاتف العميل (اختياري)</label><input className="input" dir="ltr" value={cPhone} onChange={(e) => setCPhone(e.target.value)} /></div>
        <div className="field"><label>ملاحظة (اختياري)</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn-primary" disabled={busy}>{busy ? "جاري الإنشاء…" : "إنشاء"}</button>
      </form>
      {err && <p className="login-err" role="alert">{err}</p>}
      {made.length > 0 && (
        <div className="made">
          <ul>{made.map((c) => <li key={c.id}><code dir="ltr">{formatCode(c.id)}</code><button className="btn-ghost" onClick={() => { copy(formatCode(c.id)); flash("تم النسخ"); }}>نسخ</button></li>)}</ul>
          <div className="made-actions">
            <button className="btn-ghost" onClick={() => { copy(made.map(codeLine).join("\n")); flash("تم نسخ الكل"); }}>نسخ الكل</button>
            {cPhone.replace(/\D/g, "").length >= 8 && <a className="btn-ghost" href={wa(made)} target="_blank" rel="noreferrer">إرسال واتساب</a>}
          </div>
        </div>
      )}
    </section>
  );
}

function Codes({ d, reload, flash }: { d: Overview; reload: () => void; flash: (m: string) => void }) {
  const [f, setF] = useState<"all" | CodeDoc["status"]>("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => d.codes.filter((c) => (f === "all" || c.status === f) && (!q || `${c.id} ${c.customerName} ${c.customerPhone} ${c.usedByName ?? ""} ${c.usedByPhone ?? ""} ${c.usedByEmail ?? ""}`.toLowerCase().includes(q.toLowerCase().replace(/-/g, "")))), [d.codes, f, q]);
  const act = async (code: string, action: "revoke" | "restore" | "delete") => {
    if (action === "delete" && !confirm("حذف الكود نهائيًا؟")) return;
    const { ok, data } = await api("/api/admin/codes", "PATCH", { code, action });
    if (!ok) { alert(data.error || "فشل الإجراء"); return; }
    flash("تم"); reload();
  };
  return (
    <section className="panel">
      <div className="filters">
        <input className="input" placeholder="بحث بالكود أو الاسم أو الهاتف" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={f} onChange={(e) => setF(e.target.value as any)}>
          <option value="all">كل الحالات</option><option value="unused">غير مستخدم</option><option value="used">مستخدم</option><option value="revoked">ملغي</option>
        </select>
      </div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>الكود</th><th>الاشتراك</th><th>العميل</th><th>الحالة</th><th>أُنشئ</th><th>استخدمه</th><th></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><code dir="ltr">{formatCode(c.id)}</code></td>
              <td>{entLabel(c.subject)}<small> · {c.price} {CURRENCY}</small></td>
              <td>{c.customerName || "—"}<small dir="ltr">{c.customerPhone}</small></td>
              <td><span className={`pill ${c.status === "used" ? "ok" : c.status === "revoked" ? "bad" : ""}`}>{STATUS[c.status]}</span></td>
              <td>{fmt(c.createdAt)}</td>
              <td>{c.status === "used" ? <>{c.usedByName}<small dir="ltr">{c.usedByPhone}</small><small>{fmt(c.usedAt)}</small></> : "—"}</td>
              <td className="acts">
                <button className="btn-ghost" onClick={() => { copy(formatCode(c.id)); flash("تم النسخ"); }}>نسخ</button>
                {c.status === "unused" && <button className="btn-ghost" onClick={() => act(c.id, "revoke")}>إلغاء</button>}
                {c.status === "revoked" && <button className="btn-ghost" onClick={() => act(c.id, "restore")}>استعادة</button>}
                {c.status !== "used" && <button className="btn-ghost" onClick={() => act(c.id, "delete")}>حذف</button>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="empty">لا توجد أكواد</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}

function Users({ d, reload, flash }: { d: Overview; reload: () => void; flash: (m: string) => void }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => d.users.filter((u) => !q || `${u.name} ${u.phone} ${u.email}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => Math.max(0, ...b.entitlements.map((e) => e.expiresAt)) - Math.max(0, ...a.entitlements.map((e) => e.expiresAt))), [d.users, q]);
  const act = async (uid: string, action: "grant" | "remove", subject: string, days?: number) => {
    if (action === "remove" && !confirm("إنهاء هذا الاشتراك الآن؟")) return;
    const { ok, data } = await api("/api/admin/users", "POST", { uid, action, subject, days });
    if (!ok) { alert(data.error || "فشل الإجراء"); return; }
    flash("تم"); reload();
  };
  return (
    <section className="panel">
      <div className="filters"><input className="input" placeholder="بحث بالاسم أو الهاتف أو البريد" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>المدرس</th><th>الهاتف</th><th>البريد</th><th>الاشتراكات</th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.uid}>
              <td>{u.name || <small>لم يكمل بياناته</small>}</td>
              <td dir="ltr">{u.phone || "—"}</td>
              <td dir="ltr"><small>{u.email}</small></td>
              <td>
                {u.entitlements.length ? u.entitlements.map((e) => (
                  <div key={e.subject} className="ent-row">
                    <b>{entLabel(e.subject)}</b>
                    <span className={`pill ${isActive(e, d.now) ? "ok" : "bad"}`}>{isActive(e, d.now) ? `${daysLeft(e, d.now)} يوم` : "منتهي"}</span>
                    <small>حتى {fmt(e.expiresAt)}</small>
                    <button className="btn-ghost" onClick={() => act(u.uid, "grant", e.subject, 30)}>+30 يوم</button>
                    <button className="btn-ghost" onClick={() => act(u.uid, "remove", e.subject)}>إنهاء</button>
                  </div>
                )) : <small>—</small>}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="empty">لا يوجد مشتركون</td></tr>}
        </tbody>
      </table></div>
    </section>
  );
}
