/** 单据打印页：没有侧边栏，A4 版式，浏览器「打印 → 另存为 PDF」即可导出 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">{children}</div>;
}
