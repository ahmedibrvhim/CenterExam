"use client";
import "./admin.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccess } from "@/components/AccessProvider";
import { authFetch } from "@/lib/authFetch";
import { SUBJECTS } from "@/lib/subjects";
import { CURRENCY, DAY_MS, FOREVER_AT, ORDER_STATUS_LABEL, PAID_TERMS, TERMS, TERM_LABEL, TERM_LENGTH, arDays, daysLeft, entLabel, formatCode, isActive, isForever, isOpenOrder, isTrial, leftText, termOf, type CodeDoc, type EntKey, type Entitlement, type OrderDoc, type Term, type UserDoc } from "@/lib/plans";

type Overview = { now: number; admins?: string[]; codes: CodeDoc[]; users: UserDoc[]; orders: OrderDoc[]; warning?: string };
type Tab = "orders" | "codes" | "users";
type Tone = "ok" | "warn" | "bad" | "info" | "vio" | "mute";
type OrderFilter = "open" | OrderDoc["status"] | "all";
type CodeFilter = "all" | "unused" | "running" | "expired" | "revoked";
type UserFilter = "all" | "active" | "expiring" | "expired" | "trial" | "none";
type Dlg = { title: string; body?: string; ok: string; danger?: boolean; res: (v: boolean) => void };
type UI = { toast: (m: string, kind?: "ok" | "err") => void; confirm: (o: Omit<Dlg, "res">) => Promise<boolean> };
type Ctx = { d: Overview; reload: () => void; ui: UI };

const EXPIRING_DAYS = 7;
const PAGE = 20;
const LOC = "ar-EG-u-nu-latn"; // Arabic month names, Latin digits: numbers line up and match the prices elsewhere in the app
const fmt = (t?: number) => (t ? new Date(t).toLocaleDateString(LOC, { year: "numeric", month: "short", day: "numeric" }) : "—");
const fmtTime = (t?: number) => (t ? new Date(t).toLocaleString(LOC, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const money = (n: number) => `${n.toLocaleString("en-US")} ${CURRENCY}`;

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
const waCode = (phone: string, c: CodeDoc, ref?: string) => `${waTo(phone)}?text=${encodeURIComponent(`كود اشتراك CenterExam${ref ? ` (طلب #${ref})` : ""} — ${entLabel(c.subject)} — ${TERM_LABEL[termOf(c)]} (${TERM_LENGTH[termOf(c)]}):\n${formatCode(c.id)}\nافتح الموقع وسجّل الدخول ثم أدخل الكود.`)}`;
const waRemind = (u: UserDoc, e: Entitlement, now: number) => `${waTo(u.phone)}?text=${encodeURIComponent(`مرحبًا ${u.name || ""}، اشتراكك في CenterExam (${entLabel(e.subject)}) ينتهي بعد ${arDays(daysLeft(e, now))}. بعد انتهائه يمكنك التجديد من صفحة المواد في الموقع.`)}`;

function downloadCsv(name: string, head: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [head, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" })); // BOM: Excel reads the Arabic correctly
  const a = document.createElement("a");
  a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------------ small pieces */
const Svg = ({ d, children }: { d?: string; children?: ReactNode }) => <svg viewBox="0 0 24 24" aria-hidden="true">{d ? <path d={d} /> : children}</svg>;
const IRefresh = () => <Svg d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />;
const IDown = () => <Svg d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14" />;
const IChev = () => <Svg d="m6 9 6 6 6-6" />;
const IDots = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;

const Badge = ({ tone = "mute", flat, children }: { tone?: Tone; flat?: boolean; children: ReactNode }) => <span className={`ad-badge ${tone}${flat ? " flat" : ""}`}>{children}</span>;
const TERM_TONE: Record<Term, Tone> = { month: "mute", year: "info", forever: "vio", trial: "ok" };
const TermBadge = ({ term }: { term: Term }) => <Badge tone={TERM_TONE[term]} flat>{TERM_LABEL[term]}</Badge>;
const ORDER_TONE: Record<OrderDoc["status"], Tone> = { pending: "warn", code_sent: "info", activated: "ok", cancelled: "bad" };

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string, number?][]; label: string }) {
  return (
    <div className="ad-seg" role="group" aria-label={label}>
      {options.map(([k, l, n]) => <button key={k} type="button" className={value === k ? "on" : ""} aria-pressed={value === k} onClick={() => onChange(k)}>{l}{n !== undefined && <em>{n}</em>}</button>)}
    </div>
  );
}

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="ad-search grow">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input className="ad-input" type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function TermSelect({ value, onChange }: { value: "all" | Term; onChange: (v: "all" | Term) => void }) {
  return (
    <select className="ad-input" aria-label="نوع الاشتراك" value={value} onChange={(e) => onChange(e.target.value as "all" | Term)}>
      <option value="all">كل الأنواع</option>
      {TERMS.map((t) => <option key={t} value={t}>{TERM_LABEL[t]}</option>)}
    </select>
  );
}

type Paged = { page: number; pages: number; total: number; setPage: (n: number) => void };
function usePaged<T>(rows: T[], resetKey: string): [T[], Paged] {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [resetKey]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const p = Math.min(page, pages);
  return [rows.slice((p - 1) * PAGE, p * PAGE), { page: p, pages, total: rows.length, setPage }];
}
function Pager({ pg }: { pg: Paged }) {
  if (pg.total <= PAGE) return pg.total ? <div className="ad-pager"><span>{pg.total} نتيجة</span></div> : null;
  const from = (pg.page - 1) * PAGE + 1, to = Math.min(pg.total, pg.page * PAGE);
  return (
    <div className="ad-pager">
      <span>{from}–{to} من {pg.total}</span>
      <div>
        <button type="button" className="ad-btn sm" disabled={pg.page <= 1} onClick={() => pg.setPage(pg.page - 1)}>السابق</button>
        <span>{pg.page} / {pg.pages}</span>
        <button type="button" className="ad-btn sm" disabled={pg.page >= pg.pages} onClick={() => pg.setPage(pg.page + 1)}>التالي</button>
      </div>
    </div>
  );
}
const Empty = ({ title, hint }: { title: string; hint?: string }) => <div className="ad-empty"><b>{title}</b>{hint}</div>;

type MenuItem = { label: string; onClick?: () => void; href?: string; danger?: boolean; hidden?: boolean; sep?: boolean };
function ActionMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = items.filter((i) => !i.hidden);
  const close = useCallback(() => setPos(null), []);
  useEffect(() => {
    if (!pos) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const down = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".ad-menu, .ad-more")) close(); };
    window.addEventListener("keydown", key); window.addEventListener("mousedown", down); window.addEventListener("resize", close); window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("mousedown", down); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [pos, close]);
  const toggle = () => {
    if (pos) return close();
    const r = btn.current!.getBoundingClientRect(), w = 210, h = list.length * 38 + 12;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - 4 - h) : r.bottom + 4; // flip up near the bottom of the screen
    setPos({ top, left });
  };
  return (
    <>
      <button ref={btn} type="button" className="ad-btn sm icon ad-more" aria-label={label} aria-haspopup="menu" aria-expanded={!!pos} onClick={toggle}><IDots /></button>
      {pos && (
        <div className="ad-menu" role="menu" style={{ top: pos.top, left: pos.left }}>
          {list.map((i, n) => i.sep ? <hr key={n} /> : i.href
            ? <a key={n} role="menuitem" href={i.href} target={i.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" onClick={close}>{i.label}</a>
            : <button key={n} type="button" role="menuitem" className={i.danger ? "danger" : ""} onClick={() => { close(); i.onClick?.(); }}>{i.label}</button>)}
        </div>
      )}
    </>
  );
}

function Dialog({ d, onClose }: { d: Dlg; onClose: (v: boolean) => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="ad-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(false); }}>
      <div className="ad-modal" role="alertdialog" aria-modal="true" aria-labelledby="ad-dlg-t">
        <h3 id="ad-dlg-t">{d.title}</h3>
        {d.body && <p>{d.body}</p>}
        <div className="ad-modal-actions">
          <button type="button" className="ad-btn" autoFocus={!!d.danger} onClick={() => onClose(false)}>رجوع</button>
          <button type="button" className={`ad-btn ${d.danger ? "danger" : "primary"}`} autoFocus={!d.danger} onClick={() => onClose(true)}>{d.ok}</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ numbers */
function useMetrics(d: Overview) {
  return useMemo(() => {
    const admins = d.admins ?? [];
    const paid = d.codes.filter((c) => c.status === "used" && !admins.includes(String(c.usedByEmail ?? "").toLowerCase())); // the owner's test codes are not revenue
    const sum = (from: number, to: number) => paid.filter((c) => (c.usedAt ?? 0) > from && (c.usedAt ?? 0) <= to).reduce((n, c) => n + c.price, 0);
    const rev30 = sum(d.now - 30 * DAY_MS, d.now), prev30 = sum(d.now - 60 * DAY_MS, d.now - 30 * DAY_MS);
    const months = Array.from({ length: 6 }, (_, i) => {
      const s = new Date(d.now); s.setDate(1); s.setHours(0, 0, 0, 0); s.setMonth(s.getMonth() - (5 - i));
      const e = new Date(s); e.setMonth(e.getMonth() + 1);
      return { label: s.toLocaleDateString(LOC, { month: "long" }), value: sum(s.getTime() - 1, e.getTime() - 1) };
    });
    const live = d.users.flatMap((u) => u.entitlements.filter((e) => isActive(e, d.now)));
    const expiring = d.users.flatMap((u) => u.entitlements.filter((e) => isActive(e, d.now) && !isForever(e) && !isTrial(e) && e.expiresAt - d.now <= EXPIRING_DAYS * DAY_MS).map((e) => ({ u, e })));
    return {
      rev30, prev30, revAll: paid.reduce((n, c) => n + c.price, 0), months,
      activeUsers: d.users.filter((u) => u.entitlements.some((e) => isActive(e, d.now))).length,
      forever: live.filter(isForever).length, trialsLive: live.filter(isTrial).length,
      pending: d.orders.filter((o) => o.status === "pending").length,
      awaiting: d.orders.filter((o) => o.status === "code_sent").length,
      unused: d.codes.filter((c) => c.status === "unused").length,
      expiring, expiringUsers: new Set(expiring.map((x) => x.u.uid)).size,
    };
  }, [d]);
}

function Summary({ m, go }: { m: ReturnType<typeof useMetrics>; go: (t: Tab, f?: { o?: OrderFilter; u?: UserFilter }) => void }) {
  const delta = m.prev30 > 0 ? Math.round(((m.rev30 - m.prev30) / m.prev30) * 100) : null;
  const max = Math.max(1, ...m.months.map((x) => x.value));
  const queue: { n: number; title: string; hint: string; info?: boolean; onClick: () => void }[] = [
    { n: m.pending, title: "طلب جديد بانتظار الكود", hint: "تأكد من التحويل ثم أنشئ الكود", onClick: () => go("orders", { o: "pending" }) },
    { n: m.expiringUsers, title: `مشترك ينتهي اشتراكه خلال ${EXPIRING_DAYS} أيام`, hint: "أرسل له تذكيرًا على واتساب", onClick: () => go("users", { u: "expiring" }) },
    { n: m.awaiting, title: "كود أُرسل ولم يُفعَّل بعد", hint: "قد يحتاج العميل إلى متابعة", info: true, onClick: () => go("orders", { o: "code_sent" }) },
  ].filter((x) => x.n > 0);
  return (
    <>
      <section className="ad-queue" aria-label="ما يحتاج إجراءً">
        {queue.length ? queue.map((x) => <button key={x.title} type="button" className={`ad-q${x.info ? " info" : ""}`} onClick={x.onClick}><b>{x.n}</b><span>{x.title}<small>{x.hint}</small></span></button>) : <p className="ad-q-ok">لا يوجد ما يحتاج إجراءً الآن.</p>}
      </section>
      <section className="ad-kpis" aria-label="الأرقام الرئيسية">
        <div className="ad-kpi">
          <span className="ad-kpi-l">إيراد آخر 30 يومًا</span>
          <span className="ad-kpi-v">{m.rev30.toLocaleString("en-US")}<small>{CURRENCY}</small></span>
          <span className="ad-kpi-s">{delta === null ? "لا توجد فترة سابقة للمقارنة" : <><span className={delta >= 0 ? "ad-up" : "ad-down"}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span> عن الـ 30 يومًا السابقة</>}</span>
        </div>
        <div className="ad-kpi">
          <span className="ad-kpi-l">مشتركون فعّالون</span>
          <span className="ad-kpi-v">{m.activeUsers}</span>
          <span className="ad-kpi-s">{m.forever} اشتراك دائم · {m.trialsLive} تجربة جارية</span>
        </div>
        <div className="ad-kpi">
          <span className="ad-kpi-l">إجمالي الإيراد</span>
          <span className="ad-kpi-v">{m.revAll.toLocaleString("en-US")}<small>{CURRENCY}</small></span>
          <div className="ad-bars" role="img" aria-label={`الإيراد آخر 6 أشهر: ${m.months.map((x) => `${x.label} ${x.value}`).join("، ")}`}>
            {m.months.map((x) => <i key={x.label} title={`${x.label}: ${money(x.value)}`} style={{ height: `${Math.max(8, (x.value / max) * 100)}%` }} />)}
          </div>
        </div>
        <div className="ad-kpi">
          <span className="ad-kpi-l">أكواد غير مستخدمة</span>
          <span className="ad-kpi-v">{m.unused}</span>
          <span className="ad-kpi-s">{m.pending} طلب لم يُنشأ له كود</span>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ page */
export default function AdminPage() {
  const { isAdmin } = useAccess();
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState(0);
  const [tab, setTab] = useState<Tab>("orders");
  const [of, setOf] = useState<OrderFilter>("open");
  const [uf, setUf] = useState<UserFilter>("all");
  const [toasts, setToasts] = useState<{ id: number; m: string; k: string }[]>([]);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (silent?: boolean) => {
    if (!silent) setLoading(true);
    const { ok, data } = await api("/api/admin/overview", "GET");
    setLoading(false);
    if (!ok) { if (!silent) setErr(data.error || "تعذّر تحميل البيانات."); return; }
    setErr(""); setData(data); setUpdated(Date.now());
  }, []);
  const reload = useCallback(() => { load(true); }, [load]);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  useEffect(() => { // keep the numbers fresh while the page is open
    if (!isAdmin) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, 60_000);
    return () => clearInterval(t);
  }, [isAdmin, load]);
  useEffect(() => { const h = location.hash.slice(1); if (h === "orders" || h === "codes" || h === "users") setTab(h); }, []);

  const open = (t: Tab, f?: { o?: OrderFilter; u?: UserFilter }) => {
    setTab(t); if (f?.o) setOf(f.o); if (f?.u) setUf(f.u);
    history.replaceState(null, "", `#${t}`);
  };
  const ui = useMemo<UI>(() => ({
    toast: (m, kind = "ok") => { const id = ++seq.current; setToasts((t) => [...t, { id, m, k: kind }]); setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 5000 : 2600); },
    confirm: (o) => new Promise<boolean>((res) => setDlg({ ...o, res })),
  }), []);
  const closeDlg = useCallback((v: boolean) => setDlg((cur) => { cur?.res(v); return null; }), []);
  const m = useMetrics(data ?? { now: 0, codes: [], users: [], orders: [] });

  if (!isAdmin) return (
    <main className="main-content ad" dir="rtl"><div className="ad-empty"><b>هذه الصفحة للمدير فقط</b><p style={{ marginTop: 12 }}><a href="/" className="ad-btn">العودة للأداة</a></p></div></main>
  );

  const ctx: Ctx | null = data ? { d: data, reload, ui } : null;
  const TABS: [Tab, string, number, boolean?][] = [["orders", "الطلبات", data?.orders.length ?? 0, m.pending > 0], ["codes", "الأكواد", data?.codes.length ?? 0], ["users", "المشتركون", data?.users.length ?? 0]];

  return (
    <main className="main-content ad" dir="rtl">
      <header className="ad-head">
        <div>
          <h1>لوحة الإدارة</h1>
          <p>{updated ? `آخر تحديث ${new Date(updated).toLocaleTimeString(LOC, { hour: "2-digit", minute: "2-digit" })} · يتجدد تلقائيًا كل دقيقة` : "جاري التحميل…"}</p>
        </div>
        <div className="ad-head-actions">
          <button type="button" className={`ad-btn${loading ? " spin" : ""}`} disabled={loading} onClick={() => load()}><IRefresh />تحديث</button>
          <a href="/" className="ad-btn">العودة للأداة</a>
        </div>
      </header>

      {err && <div className="ad-alert" role="alert"><span>{err}</span><button type="button" className="ad-btn sm" onClick={() => load()}>إعادة المحاولة</button></div>}
      {data?.warning && <div className="ad-alert warn" role="alert">{data.warning}</div>}
      {!data && !err && <><div className="ad-skel" /><div className="ad-skel" style={{ height: 120 }} /><div className="ad-skel" style={{ height: 280 }} /></>}

      {data && <Summary m={m} go={open} />}

      {data && (
        <>
          <div className="ad-tabs" role="tablist" aria-label="أقسام الإدارة">
            {TABS.map(([k, l, n, alert]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => open(k)}>
                {l}<span className={`ad-count${alert ? " alert" : ""}`}>{k === "orders" && m.pending ? `${m.pending} جديد` : n}</span>
              </button>
            ))}
          </div>
          {ctx && tab === "orders" && <Orders {...ctx} f={of} setF={setOf} />}
          {ctx && tab === "codes" && <Codes {...ctx} />}
          {ctx && tab === "users" && <Users {...ctx} f={uf} setF={setUf} />}
        </>
      )}

      <div className="ad-toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`ad-toast${t.k === "err" ? " err" : ""}`}>{t.m}</div>)}</div>
      {dlg && <Dialog d={dlg} onClose={closeDlg} />}
    </main>
  );
}

/* ------------------------------------------------------------------ orders */
function Orders({ d, reload, ui, f, setF }: Ctx & { f: OrderFilter; setF: (f: OrderFilter) => void }) {
  const [tf, setTf] = useState<"all" | Term>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const count = (k: OrderFilter) => d.orders.filter((o) => (k === "all" ? true : k === "open" ? isOpenOrder(o) : o.status === k)).length;
  const rows = useMemo(() => d.orders.filter((o) => (f === "all" || (f === "open" ? isOpenOrder(o) : o.status === f)) && (tf === "all" || termOf(o) === tf) && (!q || `${o.ref} ${o.name} ${o.phone} ${o.email}`.toLowerCase().includes(q.toLowerCase()))), [d.orders, f, tf, q]);
  const [page, pg] = usePaged(rows, `${f}|${tf}|${q}`);
  const codeOf = (o: OrderDoc) => (o.codeId ? d.codes.find((c) => c.id === o.codeId) : undefined);
  const userOf = (o: OrderDoc) => d.users.find((u) => u.uid === o.uid);

  // one click: creates the code from the order (subject / price / customer all come from the order) and copies it
  const makeCode = async (o: OrderDoc) => {
    setBusy(o.id);
    const { ok, data } = await api("/api/admin/codes", "POST", { orderId: o.id });
    setBusy("");
    if (!ok) { ui.toast(data.error || "تعذّر إنشاء الكود.", "err"); return; }
    const c: CodeDoc = data.codes[0];
    copy(formatCode(c.id)); ui.toast(`تم إنشاء الكود ${formatCode(c.id)} ونسخه`); reload();
  };
  const act = async (o: OrderDoc, action: "cancel" | "delete") => {
    const ok = await ui.confirm(action === "delete"
      ? { title: "حذف الطلب نهائيًا؟", body: o.status === "activated" ? "يُحذف سجل الطلب فقط، واشتراك العميل الفعّال لا يتأثر." : `سيُحذف الطلب #${o.ref}${o.codeId ? " والكود الخاص به ما لم يكن مستخدمًا" : ""}.`, ok: "حذف الطلب", danger: true }
      : { title: "إلغاء الطلب؟", body: `سيُلغى الطلب #${o.ref}${o.codeId ? " ويُلغى الكود الخاص به ما لم يكن مستخدمًا" : ""}.`, ok: "إلغاء الطلب", danger: true });
    if (!ok) return;
    setBusy(o.id);
    const r = await api("/api/admin/orders", "PATCH", { id: o.id, action });
    setBusy("");
    if (!r.ok) { ui.toast(r.data.error || "فشل الإجراء", "err"); return; }
    ui.toast(action === "delete" ? "تم حذف الطلب" : "تم إلغاء الطلب"); reload();
  };
  const exportCsv = () => downloadCsv("orders", ["رقم الطلب", "التاريخ", "الاسم", "الهاتف", "البريد", "الاشتراك", "النوع", "المبلغ", "الحالة"],
    rows.map((o) => [o.ref, new Date(o.createdAt).toISOString().slice(0, 16).replace("T", " "), o.name, o.phone, o.email, entLabel(o.subject), TERM_LABEL[termOf(o)], o.price, ORDER_STATUS_LABEL[o.status]]));
  const FILTERS: [OrderFilter, string][] = [["open", "المفتوحة"], ["pending", "جديدة"], ["code_sent", "تم إرسال الكود"], ["activated", "مُفعّلة"], ["cancelled", "ملغية"], ["all", "الكل"]];

  return (
    <section className="ad-panel" aria-label="الطلبات">
      <div className="ad-bar">
        <Seg<OrderFilter> label="حالة الطلب" value={f} onChange={setF} options={FILTERS.map(([k, l]) => [k, l, count(k)])} />
      </div>
      <div className="ad-bar">
        <Search value={q} onChange={setQ} placeholder="بحث برقم الطلب أو الاسم أو الهاتف أو البريد" />
        <TermSelect value={tf} onChange={setTf} />
        <div className="ad-bar-end"><button type="button" className="ad-btn" onClick={exportCsv} disabled={!rows.length}><IDown />تصدير CSV</button></div>
      </div>
      <div className="ad-scroll">
        <table className="ad-table">
          <thead><tr><th>الطلب</th><th>العميل</th><th>الاشتراك</th><th>المبلغ</th><th>الحالة</th><th className="end"><span className="sr-only">إجراءات</span></th></tr></thead>
          <tbody>
            {page.map((o) => {
              const c = codeOf(o), u = userOf(o), isOpen = openId === o.id;
              const current = (u?.entitlements ?? []).filter((e) => isActive(e, d.now));
              const mine = (u?.entitlements ?? []).find((x) => x.subject === o.subject);
              return [
                <tr key={o.id} className={o.status === "pending" ? "ad-flag" : ""}>
                  <td data-label="الطلب">
                    <button type="button" className="ad-expand" aria-expanded={isOpen} aria-label={`تفاصيل الطلب ${o.ref}`} onClick={() => setOpenId(isOpen ? null : o.id)}>
                      <IChev /><span><code className="ad-ltr">#{o.ref}</code><span className="ad-sub">{fmtTime(o.createdAt)}</span></span>
                    </button>
                  </td>
                  <td data-label="العميل"><span className="ad-main">{o.name}</span><span className="ad-sub ad-ltr">{o.phone}</span></td>
                  <td data-label="الاشتراك"><span className="ad-main">{o.plan === "all" ? "كل المواد" : entLabel(o.subject)}</span><span className="ad-sub"><TermBadge term={termOf(o)} /></span></td>
                  <td data-label="المبلغ"><span className="ad-main">{money(o.price)}</span>{o.plan === "all" && o.listPrice > o.price && <span className="ad-sub">خصم {Math.round((1 - o.price / o.listPrice) * 100)}%</span>}</td>
                  <td data-label="الحالة"><Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge></td>
                  <td className="end">
                    <span className="ad-row-act">
                      {o.status === "pending" && <button type="button" className="ad-btn sm primary" disabled={busy === o.id} onClick={() => makeCode(o)}>{busy === o.id ? "…" : "إنشاء كود"}</button>}
                      {o.status === "code_sent" && c && <a className="ad-btn sm wa" href={waCode(o.phone, c, o.ref)} target="_blank" rel="noreferrer">إرسال الكود</a>}
                      <ActionMenu label={`المزيد للطلب ${o.ref}`} items={[
                        { label: "نسخ الكود", hidden: !c || o.status !== "code_sent", onClick: () => { copy(formatCode(c!.id)); ui.toast("تم نسخ الكود"); } },
                        { label: "واتساب العميل", href: waTo(o.phone) },
                        { label: "اتصال", href: `tel:${o.phone}` },
                        { label: "", sep: true },
                        { label: "إلغاء الطلب", hidden: !isOpenOrder(o), danger: true, onClick: () => act(o, "cancel") },
                        { label: "حذف الطلب", danger: true, onClick: () => act(o, "delete") },
                      ]} />
                    </span>
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${o.id}-d`} className="ad-detail"><td colSpan={6}><div className="ad-detail-in">
                    <dl className="ad-fields">
                      <div><dt>البريد (حساب Google)</dt><dd className="ad-ltr">{o.email || "—"}</dd></div>
                      <div><dt>مدة الاشتراك</dt><dd>{TERM_LENGTH[termOf(o)]}</dd></div>
                      <div><dt>اشتراكه الحالي</dt><dd>{current.length ? current.map((e) => `${entLabel(e.subject)} (${isForever(e) ? "دائم" : leftText(e, d.now)})`).join("، ") : "لا يوجد"}</dd></div>
                      {c && <div><dt>الكود</dt><dd><code className="ad-ltr">{formatCode(c.id)}</code><span className="ad-sub">{c.status === "used" ? `استُخدم ${fmtTime(c.usedAt)}` : c.status === "revoked" ? "ملغي" : `أُنشئ ${fmtTime(c.createdAt)}`}</span></dd></div>}
                      {o.status === "activated" && <div><dt>تاريخ التفعيل</dt><dd>{fmtTime(o.activatedAt)}</dd></div>}
                      {o.status === "activated" && mine && <div><dt>حالة الاشتراك</dt><dd>{isActive(mine, d.now) ? <Badge tone="ok">{isForever(mine) ? "ساري · دائم" : `ساري · ${leftText(mine, d.now)}`}</Badge> : <Badge tone="bad">انتهى</Badge>}<span className="ad-sub">{isForever(mine) ? "بدون تاريخ انتهاء" : `${isActive(mine, d.now) ? "حتى" : "في"} ${fmt(mine.expiresAt)}`}</span></dd></div>}
                    </dl>
                  </div></td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
        {!rows.length && <Empty title="لا توجد طلبات" hint={q || tf !== "all" || f !== "all" ? "جرّب تغيير البحث أو التصفية." : "ستظهر هنا الطلبات عندما يطلب المدرسون اشتراكًا."} />}
      </div>
      <Pager pg={pg} />
    </section>
  );
}

/* ------------------------------------------------------------------ codes */
function Codes({ d, reload, ui }: Ctx) {
  const [f, setF] = useState<CodeFilter>("all");
  const [tf, setTf] = useState<"all" | Term>("all");
  const [q, setQ] = useState("");
  // when the subscription this code gave ends (the owner's live entitlement if it still carries this code, else use date + days)
  const endOf = (c: CodeDoc) => { if (c.status !== "used") return 0; const e = d.users.find((u) => u.uid === c.usedBy)?.entitlements.find((x) => x.code === c.id); return e?.expiresAt ?? (termOf(c) === "forever" ? FOREVER_AT : (c.usedAt ?? 0) + c.days * DAY_MS); };
  const match = (c: CodeDoc, k: CodeFilter) => k === "all" ? true : k === "running" ? c.status === "used" && endOf(c) > d.now : k === "expired" ? c.status === "used" && endOf(c) <= d.now : c.status === k;
  const rows = useMemo(() => d.codes.filter((c) => match(c, f) && (tf === "all" || termOf(c) === tf) && (!q || `${c.id} ${c.customerName} ${c.customerPhone} ${c.usedByName ?? ""} ${c.usedByPhone ?? ""} ${c.usedByEmail ?? ""}`.toLowerCase().includes(q.toLowerCase().replace(/-/g, "")))), [d.codes, d.users, f, tf, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const [page, pg] = usePaged(rows, `${f}|${tf}|${q}`);
  const act = async (c: CodeDoc, action: "revoke" | "restore" | "delete") => {
    if (action === "delete" && !(await ui.confirm({ title: "حذف الكود نهائيًا؟", body: `الكود ${formatCode(c.id)} لن يمكن استعادته.`, ok: "حذف الكود", danger: true }))) return;
    if (action === "revoke" && !(await ui.confirm({ title: "إلغاء الكود؟", body: "لن يستطيع العميل استخدامه، ويمكنك استعادته لاحقًا.", ok: "إلغاء الكود", danger: true }))) return;
    const { ok, data } = await api("/api/admin/codes", "PATCH", { code: c.id, action });
    if (!ok) { ui.toast(data.error || "فشل الإجراء", "err"); return; }
    ui.toast(action === "delete" ? "تم حذف الكود" : action === "revoke" ? "تم إلغاء الكود" : "تمت استعادة الكود"); reload();
  };
  const exportCsv = () => downloadCsv("codes", ["الكود", "الاشتراك", "النوع", "السعر", "العميل", "الهاتف", "الحالة", "تاريخ الإنشاء", "استخدمه", "تاريخ الاستخدام", "ينتهي"],
    rows.map((c) => [formatCode(c.id), entLabel(c.subject), TERM_LABEL[termOf(c)], c.price, c.customerName, c.customerPhone, { unused: "غير مستخدم", used: "مستخدم", revoked: "ملغي" }[c.status], fmt(c.createdAt), c.usedByName ?? "", c.usedAt ? fmt(c.usedAt) : "", c.status === "used" ? (endOf(c) >= FOREVER_AT ? "دائم" : fmt(endOf(c))) : ""]));
  const FILTERS: [CodeFilter, string][] = [["all", "الكل"], ["unused", "غير مستخدم"], ["running", "اشتراك ساري"], ["expired", "اشتراك منتهي"], ["revoked", "ملغي"]];

  return (
    <section className="ad-panel" aria-label="الأكواد">
      <div className="ad-bar">
        <Seg<CodeFilter> label="حالة الكود" value={f} onChange={setF} options={FILTERS.map(([k, l]) => [k, l, d.codes.filter((c) => match(c, k)).length])} />
      </div>
      <div className="ad-bar">
        <Search value={q} onChange={setQ} placeholder="بحث بالكود أو الاسم أو الهاتف" />
        <TermSelect value={tf} onChange={setTf} />
        <div className="ad-bar-end"><button type="button" className="ad-btn" onClick={exportCsv} disabled={!rows.length}><IDown />تصدير CSV</button></div>
      </div>
      <div className="ad-scroll">
        <table className="ad-table">
          <thead><tr><th>الكود</th><th>الاشتراك</th><th>العميل</th><th>استخدمه</th><th>الصلاحية</th><th className="end"><span className="sr-only">إجراءات</span></th></tr></thead>
          <tbody>
            {page.map((c) => {
              const end = endOf(c);
              return (
                <tr key={c.id}>
                  <td data-label="الكود"><code className="ad-ltr">{formatCode(c.id)}</code><span className="ad-sub">أُنشئ {fmt(c.createdAt)}</span></td>
                  <td data-label="الاشتراك"><span className="ad-main">{entLabel(c.subject)}</span><span className="ad-sub"><TermBadge term={termOf(c)} /> {money(c.price)}</span></td>
                  <td data-label="العميل"><span className="ad-main">{c.customerName || "—"}</span><span className="ad-sub ad-ltr">{c.customerPhone}</span></td>
                  <td data-label="استخدمه">{c.status === "used" ? <><span className="ad-main">{c.usedByName || "—"}</span><span className="ad-sub">{fmt(c.usedAt)}</span></> : "—"}</td>
                  <td data-label="الصلاحية">
                    {c.status === "revoked" ? <Badge tone="bad">ملغي</Badge>
                      : c.status === "unused" ? <Badge tone="warn">لم يُفعَّل بعد</Badge>
                      : end > d.now ? (end >= FOREVER_AT ? <><Badge tone="vio">دائم</Badge><span className="ad-sub">بدون تاريخ انتهاء</span></> : <><Badge tone="ok">ساري · {Math.ceil((end - d.now) / DAY_MS)} يوم</Badge><span className="ad-sub">حتى {fmt(end)}</span></>)
                      : <><Badge tone="bad">انتهى</Badge><span className="ad-sub">في {fmt(end)}</span></>}
                  </td>
                  <td className="end">
                    <span className="ad-row-act">
                      <button type="button" className="ad-btn sm" onClick={() => { copy(formatCode(c.id)); ui.toast("تم نسخ الكود"); }}>نسخ</button>
                      <ActionMenu label={`المزيد للكود ${formatCode(c.id)}`} items={[
                        { label: "إرسال على واتساب", hidden: !c.customerPhone || c.status === "used", href: c.customerPhone ? waCode(c.customerPhone, c) : undefined },
                        { label: "إلغاء الكود", hidden: c.status !== "unused", onClick: () => act(c, "revoke") },
                        { label: "استعادة الكود", hidden: c.status !== "revoked", onClick: () => act(c, "restore") },
                        { label: "", sep: true, hidden: c.status === "used" },
                        { label: "حذف الكود", hidden: c.status === "used", danger: true, onClick: () => act(c, "delete") },
                        { label: "الكود مستخدم — أنهِ الاشتراك من تبويب المشتركين", hidden: c.status !== "used", onClick: () => {} },
                      ]} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <Empty title="لا توجد أكواد" hint="تُنشأ الأكواد من تبويب الطلبات فقط." />}
      </div>
      <Pager pg={pg} />
    </section>
  );
}

/* ------------------------------------------------------------------ subscribers */
function Users({ d, reload, ui, f, setF }: Ctx & { f: UserFilter; setF: (f: UserFilter) => void }) {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const live = (u: UserDoc) => u.entitlements.filter((e) => isActive(e, d.now));
  const expiringOf = (u: UserDoc) => live(u).find((e) => !isForever(e) && !isTrial(e) && e.expiresAt - d.now <= EXPIRING_DAYS * DAY_MS);
  const lastEnd = (u: UserDoc) => Math.max(0, ...u.entitlements.map((e) => e.expiresAt));
  const match = (u: UserDoc, k: UserFilter) => k === "all" ? true : k === "none" ? !u.entitlements.length : k === "active" ? live(u).length > 0 : k === "expiring" ? !!expiringOf(u) : k === "trial" ? live(u).some(isTrial) : u.entitlements.length > 0 && !live(u).length;
  const rows = useMemo(() => d.users.filter((u) => match(u, f) && (!q || `${u.name} ${u.phone} ${u.email}`.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => f === "expiring" ? lastEnd(a) - lastEnd(b) : lastEnd(b) - lastEnd(a)), [d.users, d.now, f, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const [page, pg] = usePaged(rows, `${f}|${q}`);

  const act = async (u: UserDoc, action: "grant" | "remove" | "reset_trial", subject: string, opts: { days?: number; term?: string } = {}) => {
    const who = u.name || u.email;
    if (action === "remove" && !(await ui.confirm({ title: "إنهاء الاشتراك الآن؟", body: `سيفقد ${who} الوصول إلى «${entLabel(subject as EntKey)}» فورًا.`, ok: "إنهاء الاشتراك", danger: true }))) return;
    if (action === "reset_trial" && !(await ui.confirm({ title: "تجربة مجانية جديدة؟", body: `سيتمكن ${who} من تفعيل تجربة الساعة مرة أخرى.`, ok: "السماح بالتجربة" }))) return;
    if (action === "grant" && opts.term === "forever" && !(await ui.confirm({ title: "منح اشتراك دائم؟", body: `سيحصل ${who} على «${entLabel(subject as EntKey)}» بدون تاريخ انتهاء.`, ok: "منح دائم" }))) return;
    const { ok, data } = await api("/api/admin/users", "POST", { uid: u.uid, action, subject, ...opts });
    if (!ok) { ui.toast(data.error || "فشل الإجراء", "err"); return; }
    ui.toast(action === "grant" ? "تم منح الاشتراك" : action === "remove" ? "تم إنهاء الاشتراك" : "تمت إعادة التجربة"); reload();
  };
  const exportCsv = () => downloadCsv("subscribers", ["الاسم", "الهاتف", "البريد", "الاشتراكات الفعّالة", "آخر انتهاء", "استخدم التجربة"],
    rows.map((u) => [u.name, u.phone, u.email, live(u).map((e) => `${entLabel(e.subject)} (${isForever(e) ? "دائم" : leftText(e, d.now)})`).join(" | "), lastEnd(u) >= FOREVER_AT ? "دائم" : lastEnd(u) ? fmt(lastEnd(u)) : "", u.trialUsedAt ? "نعم" : "لا"]));
  const FILTERS: [UserFilter, string][] = [["all", "الكل"], ["active", "فعّال"], ["expiring", `ينتهي خلال ${EXPIRING_DAYS} أيام`], ["expired", "منتهي"], ["trial", "تجربة"], ["none", "بدون اشتراك"]];

  return (
    <section className="ad-panel" aria-label="المشتركون">
      <div className="ad-bar">
        <Seg<UserFilter> label="حالة المشترك" value={f} onChange={setF} options={FILTERS.map(([k, l]) => [k, l, d.users.filter((u) => match(u, k)).length])} />
      </div>
      <div className="ad-bar">
        <Search value={q} onChange={setQ} placeholder="بحث بالاسم أو الهاتف أو البريد" />
        <div className="ad-bar-end"><button type="button" className="ad-btn" onClick={exportCsv} disabled={!rows.length}><IDown />تصدير CSV</button></div>
      </div>
      <div className="ad-scroll">
        <table className="ad-table">
          <thead><tr><th>المشترك</th><th>الهاتف</th><th>الاشتراكات</th><th className="end"><span className="sr-only">إجراءات</span></th></tr></thead>
          <tbody>
            {page.map((u) => {
              const isOpen = openId === u.uid, soon = expiringOf(u);
              return [
                <tr key={u.uid} className={soon ? "ad-flag" : ""}>
                  <td data-label="المشترك">
                    <button type="button" className="ad-expand" aria-expanded={isOpen} aria-label={`إدارة ${u.name || u.email}`} onClick={() => setOpenId(isOpen ? null : u.uid)}>
                      <IChev /><span><span className="ad-main">{u.name || "لم يكمل بياناته"}</span><span className="ad-sub ad-ltr">{u.email}</span></span>
                    </button>
                  </td>
                  <td data-label="الهاتف"><span className="ad-ltr">{u.phone || "—"}</span></td>
                  <td data-label="الاشتراكات">
                    {u.entitlements.length ? (
                      <span className="ad-chips">{[...u.entitlements].sort((a, b) => b.expiresAt - a.expiresAt).map((e) => (
                        <span key={e.subject} className={`ad-chip${isActive(e, d.now) ? "" : " off"}`}><b>{entLabel(e.subject)}</b><TermBadge term={termOf(e)} /><span>{isActive(e, d.now) ? (isForever(e) ? "دائم" : leftText(e, d.now)) : "منتهي"}</span></span>
                      ))}</span>
                    ) : <span className="ad-sub">بدون اشتراك</span>}
                  </td>
                  <td className="end">
                    <span className="ad-row-act">
                      {soon && u.phone && <a className="ad-btn sm wa" href={waRemind(u, soon, d.now)} target="_blank" rel="noreferrer">تذكير</a>}
                      <button type="button" className="ad-btn sm" onClick={() => setOpenId(isOpen ? null : u.uid)}>{isOpen ? "إغلاق" : "إدارة"}</button>
                    </span>
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${u.uid}-d`} className="ad-detail"><td colSpan={4}><div className="ad-detail-in">
                    {u.entitlements.length > 0 && (
                      <div className="ad-ents">
                        {u.entitlements.map((e) => {
                          const on = isActive(e, d.now);
                          return (
                            <div key={e.subject} className="ad-ent">
                              <b>{entLabel(e.subject)}</b>
                              <TermBadge term={termOf(e)} />
                              <Badge tone={on ? "ok" : "bad"}>{on ? (isForever(e) ? "دائم" : `متبقٍّ ${leftText(e, d.now)}`) : "منتهي"}</Badge>
                              <span className="ad-sub">{isForever(e) ? "بدون تاريخ انتهاء" : `${on ? "حتى" : "انتهى"} ${isTrial(e) ? fmtTime(e.expiresAt) : fmt(e.expiresAt)}`}</span>
                              <span className="push">
                                {!isForever(e) && !isTrial(e) && <button type="button" className="ad-btn sm" onClick={() => act(u, "grant", e.subject, { days: 30 })}>+30 يوم</button>}
                                {on && <button type="button" className="ad-btn sm danger" onClick={() => act(u, "remove", e.subject)}>إنهاء</button>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <GrantBox onGrant={(subject, term) => act(u, "grant", subject, { term })} />
                    {!!u.trialUsedAt && <div className="ad-trial"><span>🎁 استخدم التجربة المجانية في {fmtTime(u.trialUsedAt)}</span><button type="button" className="ad-btn sm" onClick={() => act(u, "reset_trial", "all")}>إعادة التجربة</button></div>}
                  </div></td></tr>
                ),
              ];
            })}
          </tbody>
        </table>
        {!rows.length && <Empty title="لا يوجد مشتركون" hint={q || f !== "all" ? "جرّب تغيير البحث أو التصفية." : "سيظهر هنا كل من سجّل الدخول."} />}
      </div>
      <Pager pg={pg} />
    </section>
  );
}

// admin: give a subscriber a subject (or all) for a month / a year / forever without a code
function GrantBox({ onGrant }: { onGrant: (subject: string, term: string) => void }) {
  const [subject, setSubject] = useState("all");
  const [term, setTerm] = useState<string>("month");
  return (
    <div className="ad-grant">
      <label htmlFor="ad-g-s">منح اشتراك</label>
      <select id="ad-g-s" className="ad-input" aria-label="المادة" value={subject} onChange={(e) => setSubject(e.target.value)}>
        <option value="all">كل المواد</option>
        {SUBJECTS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="ad-input" aria-label="المدة" value={term} onChange={(e) => setTerm(e.target.value)}>
        {PAID_TERMS.map((t) => <option key={t} value={t}>{TERM_LABEL[t]}{t === "month" ? " (+30 يوم)" : t === "year" ? " (+365 يوم)" : ""}</option>)}
      </select>
      <button type="button" className="ad-btn primary" onClick={() => onGrant(subject, term)}>منح</button>
    </div>
  );
}
