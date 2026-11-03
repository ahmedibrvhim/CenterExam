"use client";
import { useEffect, useState, type ReactNode } from "react";
import Emblem from "@/components/Emblem";
import ThemePicker from "@/components/ThemePicker";
import Splash from "@/components/Splash";
import { useAuth } from "@/components/AuthProvider";

// Facebook / Instagram / WhatsApp / Messenger / TikTok in-app browsers: Google refuses sign-in there (error 403 disallowed_useragent).
const inAppBrowser = (ua: string) => /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Messenger|WhatsApp/i.test(ua);

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function LoginPage() {
  const { signIn, busy, error, configured } = useAuth();
  const [webview, setWebview] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setWebview(inAppBrowser(navigator.userAgent)); }, []);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
  };

  return (
    <main className="login" dir="rtl">
      <div className="login-top"><ThemePicker /></div>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-emblem"><Emblem animated size={96} /></div>
        <h1 id="login-title" className="login-name" dir="ltr">CenterExam</h1>
        <p className="login-sub">مولّد الاختبارات الذكي</p>
        <p className="login-lead">سجّل الدخول بحساب Google للمتابعة. تبقى مسجّلًا طوال الجلسة فقط، وعند إغلاق المتصفح يُطلب منك الدخول من جديد.</p>

        {webview ? (
          <div className="login-warn" role="alert">
            <b>افتح الرابط في المتصفح</b>
            <span>Google لا تسمح بتسجيل الدخول داخل متصفح التطبيقات (فيسبوك / واتساب / إنستغرام). افتح الرابط في Chrome أو Safari.</span>
            <button type="button" className="btn-ghost" onClick={copyLink}>{copied ? "تم النسخ ✓" : "نسخ الرابط"}</button>
          </div>
        ) : (
          <button type="button" className="google-btn" onClick={signIn} disabled={busy || !configured} aria-busy={busy}>
            {busy ? <span className="login-spin" aria-hidden="true" /> : <GoogleG />}
            <span>{busy ? "جاري تسجيل الدخول…" : "تسجيل الدخول بواسطة Google"}</span>
          </button>
        )}

        {!configured && <p className="login-err" role="alert">لم يتم ربط Firebase بعد — أضف متغيرات <code dir="ltr">NEXT_PUBLIC_FIREBASE_*</code> في ملف <code dir="ltr">.env.local</code>.</p>}
        {error && <p className="login-err" role="alert">{error}</p>}
        <p className="login-fine">باستمرارك فإنك توافق على استخدام حسابك للتعريف فقط. لا نحصل على كلمة مرور Google.</p>
      </section>
    </main>
  );
}

// Nothing of the app (header, tool, intro) is rendered until the person is signed in.
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <div className="login login-loading" role="status" aria-label="جاري التحميل"><span className="login-spin big" /></div>;
  if (status === "signedOut") return <LoginPage />;
  return (<>{children}<Splash /></>);
}
