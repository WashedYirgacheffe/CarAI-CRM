import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import localFont from "next/font/local";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource-variable/onest";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

// 品牌字和点阵字：自托管，只含拉丁字符，用在 Logo、首屏大数字等少数地方
const funnel = localFont({ src: "./fonts/funnel-display-latin.woff2", weight: "300 800", variable: "--font-funnel", display: "swap" });
const doto = localFont({ src: "./fonts/doto-latin.woff2", weight: "100 900", variable: "--font-doto", display: "swap" });

export const metadata: Metadata = {
  title: { default: "车车外贸 CRM", template: "%s · 车车外贸 CRM" },
  description: "面向中小外贸团队的多渠道客户跟进系统",
  applicationName: "车车外贸 CRM",
  appleWebApp: { capable: true, title: "CarAI", statusBarStyle: "default" },
  icons: { apple: "/brand/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#fbfbfa",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${funnel.variable} ${doto.variable}`}>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
