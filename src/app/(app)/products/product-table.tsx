"use client";

import { useState } from "react";
import Form from "next/form";
import Link from "next/link";
import { MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { StatusBadge } from "@/components/crm/bits";
import { ConfirmDialog } from "@/components/crm/confirm-dialog";
import { GalleryUpload, ImageUpload, VideoUpload, Thumb } from "@/components/crm/image-upload";
import { runAction, useActionForm } from "@/hooks/use-action-form";
import { CURRENCIES } from "@/lib/crm";
import { PRODUCT_UNITS, formatPrice } from "@/lib/docs";
import {
  deleteCategoryAction,
  deleteProductAction,
  saveCategoryAction,
  saveProductAction,
  setProductStatusAction,
} from "./actions";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  categoryId: string | null;
  categoryName: string | null;
  model: string | null;
  spec: string | null;
  unit: string;
  price: string;
  currency: string;
  costPrice: string | null;
  moq: number | null;
  hsCode: string | null;
  cartonQty: number | null;
  cartonSize: string | null;
  grossWeight: string | null;
  netWeight: string | null;
  imageUrl: string | null;
  images: string[];
  videoUrl: string | null;
  status: "ACTIVE" | "INACTIVE";
  remark: string | null;
};

type Category = { id: string; name: string; count?: number };

export function ProductFilters({
  filters,
  categories,
}: {
  filters: { q: string; category: string; status: string };
  categories: Category[];
}) {
  const autoSubmit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const active = filters.q || filters.category || filters.status !== "ACTIVE";
  return (
    <Form action="/products" className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={filters.q} placeholder="编号 / 品名 / 型号" className="pl-8" />
      </div>
      <NativeSelect name="category" defaultValue={filters.category} onChange={autoSubmit} className="w-auto" aria-label="分类">
        <option value="">全部分类</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="none">未分类</option>
      </NativeSelect>
      <NativeSelect name="status" defaultValue={filters.status} onChange={autoSubmit} className="w-auto" aria-label="状态">
        <option value="ACTIVE">在售</option>
        <option value="INACTIVE">停售</option>
        <option value="ALL">全部</option>
      </NativeSelect>
      <Button type="submit" variant="secondary">
        查询
      </Button>
      {active && (
        <Button variant="ghost" asChild>
          <Link href="/products">清空筛选</Link>
        </Button>
      )}
    </Form>
  );
}

export function ProductTable({ rows, categories, manage }: { rows: ProductRow[]; categories: Category[]; manage: boolean }) {
  const [editing, setEditing] = useState<Partial<ProductRow> | null>(null);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [managingCats, setManagingCats] = useState(false);

  return (
    <>
      {manage && (
        <div className="mb-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setManagingCats(true)}>
            管理分类
          </Button>
          <Button size="sm" onClick={() => setEditing({ unit: "pcs", currency: "USD", status: "ACTIVE" })}>
            <Plus /> 添加产品
          </Button>
        </div>
      )}
      <div className="overflow-x-auto surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">产品</TableHead>
              <TableHead>分类</TableHead>
              <TableHead>规格</TableHead>
              <TableHead className="text-right">单价</TableHead>
              <TableHead className="text-right">MOQ</TableHead>
              <TableHead>包装</TableHead>
              <TableHead>状态</TableHead>
              {manage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  {manage ? "还没有产品，点右上角「添加产品」建立产品库" : "还没有产品"}
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4">
                  <div className="flex items-center gap-3">
                    <Thumb src={p.imageUrl} alt={p.name} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="block max-w-64 truncate text-left font-medium hover:text-primary disabled:hover:text-foreground"
                        onClick={() => setEditing(p)}
                        disabled={!manage}
                      >
                        {p.name}
                      </button>
                      <p className="max-w-64 truncate text-xs text-muted-foreground">
                        <span className="tabular-nums">{p.sku}</span>
                        {p.nameEn && ` · ${p.nameEn}`}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{p.categoryName ?? "—"}</TableCell>
                <TableCell>
                  <p className="max-w-56 truncate text-sm">{[p.model, p.spec].filter(Boolean).join(" · ") || "—"}</p>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {p.currency} {formatPrice(p.price)}
                  <span className="text-muted-foreground"> / {p.unit}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.moq ?? "—"}</TableCell>
                <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                  {p.cartonQty ? `${p.cartonQty} ${p.unit}/箱` : "—"}
                  {p.cartonSize && ` · ${p.cartonSize}`}
                </TableCell>
                <TableCell>
                  {p.status === "ACTIVE" ? <StatusBadge name="在售" color="emerald" /> : <StatusBadge name="停售" color="slate" />}
                </TableCell>
                {manage && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label="更多操作">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(p)}>
                          <Pencil /> 编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => runAction(setProductStatusAction(p.id, p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"))}
                        >
                          {p.status === "ACTIVE" ? "停售" : "恢复在售"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(p)}>
                          <Trash2 /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {editing && <ProductForm product={editing} categories={categories} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={managingCats} onOpenChange={setManagingCats}>
        <DialogContent>
          <CategoryManager categories={categories} />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除「${deleting?.name ?? ""}」？`}
        description="已开出的报价单和订单不受影响（明细是当时的快照）。只是暂时不卖的话，建议改为停售。"
        action={() => deleteProductAction(deleting!.id)}
      />
    </>
  );
}

function ProductForm({ product: p, categories, onDone }: { product: Partial<ProductRow>; categories: Category[]; onDone: () => void }) {
  const [state, submit, pending] = useActionForm(saveProductAction, onDone);
  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{p.id ? "编辑产品" : "添加产品"}</DialogTitle>
      </DialogHeader>
      {p.id && <input type="hidden" name="id" value={p.id} />}
      <input type="hidden" name="status" value={p.status ?? "ACTIVE"} />
      <FieldGroup className="gap-4 py-4">
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <Field>
            <FieldLabel>主图</FieldLabel>
            <ImageUpload name="imageUrl" defaultValue={p.imageUrl} />
          </Field>
          <Field>
            <FieldLabel>产品视频</FieldLabel>
            <VideoUpload name="videoUrl" defaultValue={p.videoUrl} />
          </Field>
        </div>
        <Field>
          <FieldLabel>更多图片</FieldLabel>
          <GalleryUpload name="images" defaultValue={p.images} />
          <FieldErrors state={state} name="images" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="p-sku">产品编号</FieldLabel>
            <Input id="p-sku" name="sku" defaultValue={p.sku} placeholder="如 LED-A60-9W" required autoFocus={!p.id} />
            <FieldErrors state={state} name="sku" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-cat">分类</FieldLabel>
            <NativeSelect id="p-cat" name="categoryId" defaultValue={p.categoryId ?? ""}>
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <FieldErrors state={state} name="categoryId" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-name">中文品名</FieldLabel>
            <Input id="p-name" name="name" defaultValue={p.name} required />
            <FieldErrors state={state} name="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-name-en">英文品名</FieldLabel>
            <Input id="p-name-en" name="nameEn" defaultValue={p.nameEn ?? ""} placeholder="报价单 / PI 上优先显示" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-model">型号</FieldLabel>
            <Input id="p-model" name="model" defaultValue={p.model ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-hs">HS 编码</FieldLabel>
            <Input id="p-hs" name="hsCode" defaultValue={p.hsCode ?? ""} />
            <FieldErrors state={state} name="hsCode" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="p-spec">规格描述</FieldLabel>
          <Textarea id="p-spec" name="spec" defaultValue={p.spec ?? ""} rows={2} placeholder="材质、尺寸、颜色、功率等，会带到单据明细（建议英文）" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="p-price">销售单价</FieldLabel>
            <div className="flex gap-2">
              <Input id="p-price" name="price" type="number" min={0} step="0.0001" defaultValue={p.price ?? ""} required />
              <NativeSelect name="currency" defaultValue={p.currency ?? "USD"} className="w-24" aria-label="币种">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </div>
            <FieldErrors state={state} name="price" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-unit">单位</FieldLabel>
            <Input id="p-unit" name="unit" defaultValue={p.unit ?? "pcs"} list="product-units" required />
            <datalist id="product-units">
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field>
            <FieldLabel htmlFor="p-moq">MOQ</FieldLabel>
            <Input id="p-moq" name="moq" type="number" min={0} step="1" defaultValue={p.moq ?? ""} />
            <FieldErrors state={state} name="moq" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="p-cost">成本价（CNY）</FieldLabel>
          <Input id="p-cost" name="costPrice" type="number" min={0} step="0.0001" defaultValue={p.costPrice ?? ""} className="sm:w-48" />
          <FieldDescription>仅内部可见，不会出现在单据上</FieldDescription>
          <FieldErrors state={state} name="costPrice" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="p-cq">每箱数量</FieldLabel>
            <Input id="p-cq" name="cartonQty" type="number" min={0} step="1" defaultValue={p.cartonQty ?? ""} />
            <FieldErrors state={state} name="cartonQty" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-cs">外箱尺寸</FieldLabel>
            <Input id="p-cs" name="cartonSize" defaultValue={p.cartonSize ?? ""} placeholder="60×40×35 cm" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-gw">毛重 kg</FieldLabel>
            <Input id="p-gw" name="grossWeight" type="number" min={0} step="0.001" defaultValue={p.grossWeight ?? ""} />
            <FieldErrors state={state} name="grossWeight" />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-nw">净重 kg</FieldLabel>
            <Input id="p-nw" name="netWeight" type="number" min={0} step="0.001" defaultValue={p.netWeight ?? ""} />
            <FieldErrors state={state} name="netWeight" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="p-remark">备注</FieldLabel>
          <Textarea id="p-remark" name="remark" defaultValue={p.remark ?? ""} rows={2} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CategoryManager({ categories }: { categories: Category[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [state, submit, pending] = useActionForm(saveCategoryAction, (form) => {
    form.reset();
    setEditingId(null);
  });
  const [deleting, setDeleting] = useState<Category | null>(null);
  const editing = categories.find((c) => c.id === editingId);
  return (
    <>
      <DialogHeader>
        <DialogTitle>产品分类</DialogTitle>
      </DialogHeader>
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {categories.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">还没有分类</li>}
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="flex-1">{c.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{c.count ?? 0} 个产品</span>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`重命名 ${c.name}`} onClick={() => setEditingId(c.id)}>
              <Pencil className="size-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="size-7" aria-label={`删除 ${c.name}`} onClick={() => setDeleting(c)}>
              <Trash2 className="size-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} key={editingId ?? "new"} className="space-y-2">
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <div className="flex gap-2">
          <Input name="name" defaultValue={editing?.name} placeholder={editing ? "新名称" : "新分类名称"} required autoFocus={!!editing} />
          <Button type="submit" disabled={pending}>
            {editing ? "重命名" : "添加"}
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={() => setEditingId(null)}>
              取消
            </Button>
          )}
        </div>
        <FieldErrors state={state} name="name" />
      </form>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`删除分类「${deleting?.name ?? ""}」？`}
        description="分类下的产品不会被删除，会变为未分类。"
        action={() => deleteCategoryAction(deleting!.id)}
      />
    </>
  );
}
