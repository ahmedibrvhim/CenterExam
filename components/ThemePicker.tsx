"use client";
import { useEffect, useRef, useState } from "react";
import { THEMES, DEFAULT_THEME, applyTheme } from "@/lib/themes";

const KEY = "centerapp-exams-theme";

export default function ThemePicker() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(DEFAULT_THEME);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    const key = saved && THEMES[saved] ? saved : DEFAULT_THEME;
    setActive(key);
    applyTheme(key);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const pick = (k: string) => {
    setActive(k);
    applyTheme(k);
    try { localStorage.setItem(KEY, k); } catch {}
    setOpen(false);
  };

  return (
    <div className="theme-wrap" ref={wrap}>
      <button type="button" className="theme-dot-btn" aria-label="تغيير السمة" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="theme-dot-ring" />
      </button>
      {open && (
        <div className="theme-popup" role="menu">
          <div className="theme-popup-header">🎨 اختر السمة</div>
          <div className="theme-grid">
            {Object.entries(THEMES).map(([k, t]) => (
              <button key={k} type="button" role="menuitemradio" aria-checked={k === active}
                className={`theme-card${k === active ? " active" : ""}`} onClick={() => pick(k)}>
                <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})` }} />
                <span>{t.emoji} {t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
