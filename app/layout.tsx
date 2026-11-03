import type { Metadata, Viewport } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import AuthGate from "@/components/AuthGate";
import { themeBootScript } from "@/lib/themes";

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
    <html lang="ar" dir="rtl" suppressHydrationWarning>
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
