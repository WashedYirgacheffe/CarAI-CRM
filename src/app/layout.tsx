import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "车车外贸 CRM", template: "%s · 车车外贸 CRM" },
  description: "面向中小外贸团队的多渠道客户跟进系统",
  applicationName: "车车外贸 CRM",
  appleWebApp: { capable: true, title: "CarAI", statusBarStyle: "default" },
  icons: { apple: "/brand/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
