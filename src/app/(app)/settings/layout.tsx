/** 设置页的二级菜单由外壳的模块菜单提供 */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <div className="min-w-0">{children}</div>;
}
