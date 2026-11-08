import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { CustomerFilters, Pager } from "@/components/crm/customer-filters";
import { CustomerTable } from "@/components/crm/customer-table";
import { can, requirePermission } from "@/server/auth";
import { scopeMembers } from "@/server/scope";
import { customerOptions, listCustomers, parseFilters } from "@/server/customer-list";

export const metadata: Metadata = { title: "我的客户" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const user = await requirePermission("customer.view");
  const filters = parseFilters(await searchParams);
  const [list, options, members] = await Promise.all([
    listCustomers(user, filters, "mine"),
    customerOptions(user.tenantId),
    scopeMembers(user),
  ]);
  return (
    <>
      <PageHeader
        title="我的客户"
        description={user.dataScope === "SELF" ? "你负责的私海客户" : "你和数据范围内同事负责的私海客户"}
      />
      <CustomerFilters action="/customers" filters={filters} options={options} members={members} />
      <CustomerTable
        rows={list.rows}
        mode="mine"
        tz={user.timezone}
        members={members}
        options={options}
        perms={{
          create: can(user, "customer.create"),
          transfer: can(user, "customer.transfer"),
          release: can(user, "customer.edit"),
        }}
      />
      <Pager path="/customers" filters={filters} page={filters.page} pages={list.pages} total={list.total} />
    </>
  );
}
