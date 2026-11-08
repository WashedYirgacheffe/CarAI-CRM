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
      <Form action="/customers/contacts" className="mb-4 flex gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={q} placeholder="姓名 / 邮箱 / 电话 / 公司" className="pl-8" />
        </div>
        <Button type="submit" variant="secondary">
          查询
        </Button>
      </Form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">姓名</TableHead>
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
                <TableCell className="pl-4">
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
      </div>
      <Pager path="/customers/contacts" filters={{ q }} page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} total={total} />
    </>
  );
}
