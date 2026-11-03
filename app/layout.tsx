import type { Metadata, Viewport } from "next";
import { Cairo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import AuthGate from "@/components/AuthGate";
import { themeBootScript } from "@/lib/themes";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-cairo",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CenterExam — مولّد الاختبارات",
  description: "حوّل ملفات PDF إلى اختبارات بعدة نسخ جاهزة للتنزيل.",
  applicationName: "CenterExam",
  appleWebApp: { capable: true, title: "CenterExam", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#030c12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* applies the saved theme (and skips the intro if already shown) before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
        <noscript><style>{".splash{display:none!important}"}</style></noscript>
      </head>
      <body>
        <AuthProvider>
          <AuthGate>{children}</AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
