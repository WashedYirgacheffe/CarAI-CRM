/** 发给客户的公开页面（报价单、表单）：不需要登录，没有侧边栏 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="en" className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">
      {children}
    </div>
  );
}
