import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/crm/customer-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import { ownedWhere } from "@/server/scope";
import { PAGE_SIZE } from "@/server/customer-list";
import { countryName } from "@/lib/crm";

export const metadata: Metadata = { title: "联系人" };

export default async function ContactsPage({ searchParams }: PageProps<"/customers/contacts">) {
  const user = await requirePermission("customer.view");
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const contains = { contains: q, mode: "insensitive" as const };
  const where = {
    customer: await ownedWhere(user),
    ...(q
      ? { OR: [{ name: contains }, { email: contains }, { phone: contains }, { whatsapp: contains }, { customer: { name: contains } }] }
      : {}),
  };
  const db = tenantDb(user.tenantId);
  const [total, rows] = await Promise.all([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { customer: { select: { id: true, name: true, country: true, owner: { select: { name: true } } } } },
    }),
  ]);

  return (
    <>
      <PageHeader title="联系人" description="你数据范围内私海客户的全部联系人" />
      <div className="overflow-hidden surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-5 py-3">
          <h2 className="mr-1 flex min-h-8 items-baseline gap-1.5 text-[15px] font-semibold">
            {q ? "搜索结果" : "全部联系人"}
            <span className="text-[13px] font-normal text-muted-foreground">
              · <span className="tabular-nums">{total}</span> 个联系人
            </span>
          </h2>
          <Form action="/customers/contacts" className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <div className="relative w-full sm:w-64">
              <button
                type="submit"
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="搜索"
              >
                <Search className="size-4" />
              </button>
              <Input name="q" defaultValue={q} placeholder="姓名 / 邮箱 / 电话 / 公司" className="h-8 pl-8 text-[13px]" />
            </div>
            {q && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/customers/contacts">清空</Link>
              </Button>
            )}
          </Form>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>电话 / WhatsApp</TableHead>
              <TableHead>所属客户</TableHead>
              <TableHead>负责人</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  没有联系人
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <span className="font-medium">{r.name}</span>
                  {r.isPrimary && (
                    <Badge variant="secondary" className="ml-2">
                      主
                    </Badge>
                  )}
                  {r.title && <div className="text-xs text-muted-foreground">{r.title}</div>}
                </TableCell>
                <TableCell>{r.email ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-sm">
                  {r.phone}
                  {r.whatsapp && <div className="text-xs text-muted-foreground">WA {r.whatsapp}</div>}
                  {!r.phone && !r.whatsapp && <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">
                    {r.customer.name}
                  </Link>
                  {r.customer.country && <div className="text-xs text-muted-foreground">{countryName(r.customer.country)}</div>}
                </TableCell>
                <TableCell>{r.customer.owner?.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pager
          path="/customers/contacts"
          filters={{ q }}
          page={page}
          pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          total={total}
          className="mt-0 border-t border-border/70 px-5 py-3"
        />
      </div>
    </>
  );
}
