"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { NativeSelect } from "@/components/native-select";
import { FieldErrors, FormMessage } from "@/components/form-bits";
import { useActionForm } from "@/hooks/use-action-form";
import { COUNTRIES, CUSTOMER_SOURCES, CUSTOMER_TYPES } from "@/lib/crm";
import { checkDuplicateAction, createCustomerAction, updateCustomerAction, type DuplicateHit } from "@/app/(app)/customers/actions";

export type CustomerOptionsProp = {
  statuses: { id: string; name: string; color: string }[];
  groups: { id: string; name: string; depth: number }[];
};

export type EditableCustomer = {
  id: string;
  name: string;
  country: string | null;
  website: string | null;
  address: string | null;
  source: string | null;
  customerType: string | null;
  mainProducts: string | null;
  annualVolume: string | null;
  remark: string | null;
  statusId: string | null;
  groupId: string | null;
  star: number;
  tags: string[];
};

/** 新建 / 编辑客户表单（放在 DialogContent 里用） */
export function CustomerForm({ customer, options, onDone }: { customer?: EditableCustomer; options: CustomerOptionsProp; onDone: () => void }) {
  const router = useRouter();
  const isNew = !customer;
  const [state, submit, pending] = useActionForm(isNew ? createCustomerAction : updateCustomerAction, (_f, r) => {
    onDone();
    if (isNew && "id" in r && r.id) router.push(`/customers/${r.id}`);
  });
  const [dups, setDups] = useState<DuplicateHit[]>([]);

  async function check(form: HTMLFormElement | null) {
    if (!form) return;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const website = String(fd.get("website") ?? "").trim();
    const email = String(fd.get("contactEmail") ?? "").trim();
    if (name.length < 2 && !website && !email) return setDups([]);
    setDups(await checkDuplicateAction({ name: name.length >= 2 ? name : undefined, website, email, excludeId: customer?.id }));
  }

  const onBlurCheck = (e: React.FocusEvent<HTMLInputElement>) => check(e.currentTarget.form);

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{isNew ? "新建客户" : "编辑客户资料"}</DialogTitle>
      </DialogHeader>
      {customer && <input type="hidden" name="id" value={customer.id} />}
      <FieldGroup className="max-h-[68vh] gap-4 overflow-y-auto py-4 pr-1">
        <FormMessage state={state} />
        {dups.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="mb-1 flex items-center gap-1.5 font-medium">
              <TriangleAlert className="size-4" /> 可能是重复客户
            </p>
            <ul className="space-y-0.5">
              {dups.map((d) => (
                <li key={d.id}>
                  {d.visible ? (
                    <Link href={`/customers/${d.id}`} className="underline underline-offset-2" target="_blank">
                      {d.name}
                    </Link>
                  ) : (
                    d.name
                  )}
                  <span className="text-amber-800/80">
                    {" "}
                    · {d.reason} · {d.inPool ? "在公海中，可领取" : `负责人 ${d.ownerName ?? "—"}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="c-name">公司名称</FieldLabel>
          <Input id="c-name" name="name" defaultValue={customer?.name} required autoFocus onBlur={onBlurCheck} />
          <FieldErrors state={state} name="name" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="c-country">国家 / 地区</FieldLabel>
            <NativeSelect id="c-country" name="country" defaultValue={customer?.country ?? ""}>
              <option value="">未填写</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-website">官网</FieldLabel>
            <Input id="c-website" name="website" defaultValue={customer?.website ?? ""} placeholder="example.com" onBlur={onBlurCheck} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-status">客户状态</FieldLabel>
            <NativeSelect id="c-status" name="statusId" defaultValue={customer?.statusId ?? options.statuses[0]?.id ?? ""}>
              <option value="">无</option>
              {options.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-group">客户分组</FieldLabel>
            <NativeSelect id="c-group" name="groupId" defaultValue={customer?.groupId ?? ""}>
              <option value="">未分组</option>
              {options.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {"　".repeat(g.depth) + g.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-source">客户来源</FieldLabel>
            <NativeSelect id="c-source" name="source" defaultValue={customer?.source ?? ""}>
              <option value="">未填写</option>
              {CUSTOMER_SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-type">客户类型</FieldLabel>
            <NativeSelect id="c-type" name="customerType" defaultValue={customer?.customerType ?? ""}>
              <option value="">未填写</option>
              {CUSTOMER_TYPES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-star">星级</FieldLabel>
            <NativeSelect id="c-star" name="star" defaultValue={String(customer?.star ?? 0)}>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n ? "★".repeat(n) : "未评级"}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-volume">年采购额</FieldLabel>
            <Input id="c-volume" name="annualVolume" defaultValue={customer?.annualVolume ?? ""} placeholder="如 USD 50万-100万" />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="c-products">主营产品</FieldLabel>
          <Input id="c-products" name="mainProducts" defaultValue={customer?.mainProducts ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-tags">标签</FieldLabel>
          <Input id="c-tags" name="tags" defaultValue={customer?.tags.join("，") ?? ""} placeholder="用逗号分隔，如：展会客户，高意向" />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-address">地址</FieldLabel>
          <Input id="c-address" name="address" defaultValue={customer?.address ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="c-remark">备注</FieldLabel>
          <Textarea id="c-remark" name="remark" defaultValue={customer?.remark ?? ""} rows={2} />
        </Field>

        {isNew && (
          <>
            <FieldSeparator>主联系人</FieldSeparator>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="c-cname">姓名</FieldLabel>
                <Input id="c-cname" name="contactName" />
              </Field>
              <Field>
                <FieldLabel htmlFor="c-ctitle">职位</FieldLabel>
                <Input id="c-ctitle" name="contactTitle" placeholder="如 Purchasing Manager" />
              </Field>
              <Field>
                <FieldLabel htmlFor="c-cemail">邮箱</FieldLabel>
                <Input id="c-cemail" name="contactEmail" type="email" onBlur={onBlurCheck} />
                <FieldErrors state={state} name="contactEmail" />
              </Field>
              <Field>
                <FieldLabel htmlFor="c-cphone">电话</FieldLabel>
                <Input id="c-cphone" name="contactPhone" />
              </Field>
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="c-cwa">WhatsApp</FieldLabel>
                <Input id="c-cwa" name="contactWhatsapp" placeholder="带国家区号，如 +1 555 123 4567" />
                <FieldDescription>邮箱用企业域名时，会一起参与查重。</FieldDescription>
              </Field>
            </div>
          </>
        )}
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : isNew ? "创建客户" : "保存"}
        </Button>
      </DialogFooter>
    </form>
  );
}
