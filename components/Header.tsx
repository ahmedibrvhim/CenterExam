import ThemePicker from "@/components/ThemePicker";

export default function Header() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="brand" aria-label="CenterApp Exams">
          <span className="brand-name">CenterApp</span>
          <span className="brand-sub">Exams</span>
        </a>
        <p className="site-tagline">حوّل ملفات PDF إلى اختبارات بعدة نسخ</p>
        <ThemePicker />
      </div>
    </header>
  );
}
