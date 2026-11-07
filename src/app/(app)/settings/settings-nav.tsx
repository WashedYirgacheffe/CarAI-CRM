"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { NavLeaf } from "@/lib/nav";

export function SettingsNav({ groups }: { groups: { group: string; items: NavLeaf[] }[] }) {
  const pathname = usePathname();
  return (
    <nav className="shrink-0 lg:w-48" aria-label="设置">
      {groups.map((g) => (
        <div key={g.group} className="mb-4">
          <p className="mb-1 px-2 text-xs font-medium text-muted-foreground">{g.group}</p>
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {g.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-foreground/80 hover:bg-muted",
                    )}
                  >
                    {item.title}
                    {item.phase && <span className="text-[10px] text-muted-foreground">{item.phase}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
