import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/crm/customer-filters";
import { can, requirePermission } from "@/server/auth";
import { tenantDb } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { ProductFilters, ProductTable } from "./product-table";

export const metadata: Metadata = { title: "产品" };

const PAGE_SIZE = 20;

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const user = await requirePermission("product.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const filters = {
    q: str("q"),
    category: str("category"),
    status: str("status") || "ACTIVE",
    page: Math.max(1, Number(str("page")) || 1),
  };
  const db = tenantDb(user.tenantId);
  const where: Prisma.ProductWhereInput = {
    ...(filters.status !== "ALL" ? { status: filters.status === "INACTIVE" ? "INACTIVE" : "ACTIVE" } : {}),
    ...(filters.category === "none" ? { categoryId: null } : filters.category ? { categoryId: filters.category } : {}),
    ...(filters.q
      ? {
          OR: [
            { sku: { contains: filters.q, mode: "insensitive" } },
            { name: { contains: filters.q, mode: "insensitive" } },
            { nameEn: { contains: filters.q, mode: "insensitive" } },
            { model: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const manage = can(user, "product.manage");
  const [total, rows, categories] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (filters.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: { select: { name: true } } },
    }),
    db.productCategory.findMany({ orderBy: { sort: "asc" }, include: { _count: { select: { products: true } } } }),
  ]);

  return (
    <>
      <PageHeader title="产品" description="产品资料会带入报价单和订单明细；停售的产品不会出现在新单据里。" />
      <ProductFilters filters={filters} categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
      <ProductTable
        manage={manage}
        categories={categories.map((c) => ({ id: c.id, name: c.name, count: c._count.products }))}
        rows={rows.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          nameEn: p.nameEn,
          categoryId: p.categoryId,
          categoryName: p.category?.name ?? null,
          model: p.model,
          spec: p.spec,
          unit: p.unit,
          price: p.price.toString(),
          currency: p.currency,
          // 成本价只给有管理权限的人
          costPrice: manage ? (p.costPrice?.toString() ?? null) : null,
          moq: p.moq,
          hsCode: p.hsCode,
          cartonQty: p.cartonQty,
          cartonSize: p.cartonSize,
          grossWeight: p.grossWeight?.toString() ?? null,
          netWeight: p.netWeight?.toString() ?? null,
          imageUrl: p.imageUrl,
          status: p.status,
          remark: p.remark,
        }))}
      />
      <Pager
        path="/products"
        filters={filters}
        page={filters.page}
        pages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        total={total}
      />
    </>
  );
}
