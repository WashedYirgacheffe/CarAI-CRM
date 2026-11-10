"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma, tenantDb } from "@/server/db";
import { can, requireUser, type CurrentUser } from "@/server/auth";
import { inScope, ownedWhere } from "@/server/scope";
import { enroll, type Recipient } from "@/server/sequences";
import { fieldErrorsOf, type ActionState } from "@/lib/action";
import { countryName } from "@/lib/crm";

const denied = (message = "没有操作权限"): ActionState => ({ ok: false, message });

async function mailUser() {
  const user = await requireUser();
  return can(user, "mail.use") ? user : null;
}

async function ownSequence(user: CurrentUser, id: string) {
  const seq = await tenantDb(user.tenantId).mailSequence.findFirst({ where: { id } });
  if (!seq || !(await inScope(user, seq.ownerId))) return null;
  return seq;
}

function revalidate(id?: string) {
  revalidatePath("/marketing");
  if (id) revalidatePath(`/marketing/${id}`);
}

const stepSchema = z.object({
  delayDays: z.coerce.number().int().min(0, "间隔不能为负").max(365),
  subject: z.string().trim().min(1, "每封邮件都要有主题").max(300),
  body: z.string().trim().min(1, "每封邮件都要有正文").max(20000),
});

const schema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, "请填写名称").max(100),
  accountId: z.string().min(1, "请选择发件邮箱"),
  dailyLimit: z.coerce.number().int().min(1, "至少 1 封").max(2000, "每天最多 2000 封"),
  workHours: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  stopOnReply: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  steps: z
    .string()
    .transform((v, ctx) => {
      try {
        return JSON.parse(v) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "邮件内容格式不正确" });
        return z.NEVER;
      }
    })
    .pipe(z.array(stepSchema).min(1, "至少要有一封邮件").max(10, "最多 10 封")),
});

export async function saveSequenceAction(_p: ActionState, fd: FormData): Promise<ActionState & { id?: string }> {
  const user = await mailUser();
  if (!user) return denied();
  const parsed = schema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    const r = fieldErrorsOf(parsed.error);
    const stepErr = parsed.error.issues.find((i) => i.path[0] === "steps");
    return stepErr ? { ...r, message: stepErr.message } : r;
  }
  const { id, steps, ...data } = parsed.data;
  const db = tenantDb(user.tenantId);
  const seq = id ? await ownSequence(user, id) : null;
  if (id && !seq) return denied();
  // 只能用自己绑定的邮箱；主管编辑下属的序列时可以保留原邮箱
  const account = await db.mailAccount.findFirst({ where: { id: data.accountId, userId: user.id } });
  if (!account && data.accountId !== seq?.accountId) return { ok: false, fieldErrors: { accountId: ["只能用自己绑定的邮箱发送"] } };

  const stepRows = steps.map((s, i) => ({ ...s, sort: i }));
  if (id) {
    await prisma.$transaction([
      prisma.mailSequence.update({ where: { id }, data }),
      prisma.mailSequenceStep.deleteMany({ where: { sequenceId: id } }),
      prisma.mailSequenceStep.createMany({ data: stepRows.map((s) => ({ ...s, sequenceId: id })) }),
      // 换了发件邮箱：还没发完的收件人跟着换
      prisma.mailEnrollment.updateMany({ where: { sequenceId: id, status: "ACTIVE" }, data: { accountId: data.accountId } }),
    ]);
    revalidate(id);
    return { ok: true, message: "已保存", id };
  }
  const created = await prisma.mailSequence.create({
    data: { ...data, tenantId: user.tenantId, ownerId: user.id, steps: { create: stepRows } },
  });
  revalidate();
  return { ok: true, message: "已创建，接下来添加收件人", id: created.id };
}

export async function setSequenceStatusAction(id: string, active: boolean): Promise<ActionState> {
  const user = await mailUser();
  if (!user) return denied();
  const seq = await ownSequence(user, id);
  if (!seq) return denied();
  await prisma.mailSequence.update({ where: { id }, data: { status: active ? "ACTIVE" : "PAUSED" } });
  revalidate(id);
  return { ok: true, message: active ? "已恢复发送" : "已暂停，进行中的收件人不会再收到邮件" };
}

export async function deleteSequenceAction(id: string): Promise<ActionState> {
  const user = await mailUser();
  if (!user) return denied();
  const seq = await ownSequence(user, id);
  if (!seq) return denied();
  await prisma.mailSequence.delete({ where: { id } });
  revalidate();
  return { ok: true, message: "已删除" };
}

export async function stopEnrollmentsAction(sequenceId: string, ids: string[]): Promise<ActionState> {
  const user = await mailUser();
  if (!user) return denied();
  if (!(await ownSequence(user, sequenceId))) return denied();
  const { count } = await prisma.mailEnrollment.updateMany({
    where: { sequenceId, id: { in: ids }, status: "ACTIVE" },
    data: { status: "STOPPED", nextAt: null },
  });
  revalidate(sequenceId);
  return { ok: true, message: count ? `已停止 ${count} 位收件人` : "选中的收件人都不在进行中" };
}

export async function removeEnrollmentsAction(sequenceId: string, ids: string[]): Promise<ActionState> {
  const user = await mailUser();
  if (!user) return denied();
  if (!(await ownSequence(user, sequenceId))) return denied();
  // 已经发过信的保留记录，只删还没发过的
  const { count } = await prisma.mailEnrollment.deleteMany({ where: { sequenceId, id: { in: ids }, lastSentAt: null } });
  revalidate(sequenceId);
  return { ok: true, message: count === ids.length ? `已移除 ${count} 位` : `已移除 ${count} 位；已发过邮件的保留记录，可改为停止` };
}

// ── 添加收件人 ──

export type RecipientOption = { id: string; label: string; sub: string; email: string; enrolled?: boolean };

/** 弹窗里搜索客户 / 线索。客户取主联系人（没有主联系人就取第一个有邮箱的） */
export async function searchRecipientsAction(
  sequenceId: string,
  kind: "customer" | "lead",
  q: string,
  statusId?: string,
): Promise<RecipientOption[]> {
  const user = await mailUser();
  if (!user || !(await ownSequence(user, sequenceId))) return [];
  const db = tenantDb(user.tenantId);
  const contains = { contains: q.trim(), mode: "insensitive" as const };
  const enrolled = new Set(
    (await prisma.mailEnrollment.findMany({ where: { sequenceId }, select: { email: true } })).map((e) => e.email.toLowerCase()),
  );
  if (kind === "customer") {
    const rows = await db.customer.findMany({
      where: {
        AND: [
          await ownedWhere(user),
          { contacts: { some: { email: { not: null } } } },
          statusId ? { statusId } : {},
          q.trim() ? { OR: [{ name: contains }, { contacts: { some: { OR: [{ name: contains }, { email: contains }] } } }] } : {},
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true,
        name: true,
        country: true,
        contacts: {
          where: { email: { not: null } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          take: 1,
          select: { name: true, email: true },
        },
      },
    });
    return rows
      .filter((c) => c.contacts[0]?.email)
      .map((c) => {
        const ct = c.contacts[0];
        return {
          id: c.id,
          label: c.name,
          sub: [ct.name, c.country ? countryName(c.country) : null].filter(Boolean).join(" · "),
          email: ct.email!,
          enrolled: enrolled.has(ct.email!.toLowerCase()),
        };
      });
  }
  const scope = await ownedWhere(user);
  const rows = await db.lead.findMany({
    where: {
      AND: [
        { email: { not: null } },
        { status: { not: "INVALID" } },
        { OR: [scope, { ownerId: null }] },
        q.trim() ? { OR: [{ companyName: contains }, { contactName: contains }, { email: contains }] } : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, companyName: true, contactName: true, email: true, country: true },
  });
  return rows.map((l) => ({
    id: l.id,
    label: l.companyName || l.contactName || l.email!,
    sub: [l.contactName, l.country ? countryName(l.country) : null].filter(Boolean).join(" · "),
    email: l.email!,
    enrolled: enrolled.has(l.email!.toLowerCase()),
  }));
}

function summary(r: Awaited<ReturnType<typeof enroll>>): ActionState {
  const skipped = [
    r.duplicate > 0 && `${r.duplicate} 位已在序列中`,
    r.suppressed > 0 && `${r.suppressed} 位退订或退信`,
    r.invalid > 0 && `${r.invalid} 个邮箱格式不对`,
  ].filter(Boolean);
  return { ok: r.added > 0 || skipped.length > 0, message: `已添加 ${r.added} 位收件人${skipped.length ? `；跳过：${skipped.join("，")}` : ""}` };
}

export async function enrollAction(
  sequenceId: string,
  input: { kind: "customer" | "lead"; ids: string[] } | { kind: "paste"; text: string },
): Promise<ActionState> {
  const user = await mailUser();
  if (!user) return denied();
  if (!(await ownSequence(user, sequenceId))) return denied();
  const db = tenantDb(user.tenantId);
  let list: Recipient[] = [];

  if (input.kind === "customer") {
    const rows = await db.customer.findMany({
      where: { AND: [await ownedWhere(user), { id: { in: input.ids.slice(0, 2000) } }] },
      select: {
        id: true,
        name: true,
        country: true,
        contacts: {
          where: { email: { not: null } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          take: 1,
          select: { id: true, name: true, email: true },
        },
      },
    });
    list = rows
      .filter((c) => c.contacts[0])
      .map((c) => ({
        email: c.contacts[0].email!,
        name: c.contacts[0].name,
        company: c.name,
        country: c.country ? countryName(c.country) : null,
        customerId: c.id,
        contactId: c.contacts[0].id,
      }));
  } else if (input.kind === "lead") {
    const scope = await ownedWhere(user);
    const rows = await db.lead.findMany({
      where: { id: { in: input.ids.slice(0, 2000) }, email: { not: null }, OR: [scope, { ownerId: null }] },
      select: { id: true, email: true, contactName: true, companyName: true, country: true, customerId: true },
    });
    list = rows.map((l) => ({
      email: l.email!,
      name: l.contactName,
      company: l.companyName,
      country: l.country ? countryName(l.country) : null,
      leadId: l.id,
      customerId: l.customerId,
    }));
  } else if (input.kind === "paste") {
    // 每行一个：邮箱[, 姓名[, 公司[, 国家]]]，逗号 / Tab / 分号分隔都行
    list = input.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 5000)
      .map((line) => {
        const cells = line.split(/[,\t;，；]/).map((c) => c.trim());
        const at = cells.findIndex((c) => c.includes("@"));
        const email = at >= 0 ? cells.splice(at, 1)[0].replace(/^<|>$/g, "") : line;
        return { email, name: cells[0] || null, company: cells[1] || null, country: cells[2] || null };
      });
    // 已在 CRM 里的邮箱关联到对应客户
    const emails = list.map((r) => r.email.toLowerCase());
    const contacts = await db.contact.findMany({
      where: { email: { in: emails, mode: "insensitive" } },
      select: { id: true, email: true, name: true, customer: { select: { id: true, name: true, country: true } } },
    });
    const byEmail = new Map(contacts.map((c) => [c.email!.toLowerCase(), c]));
    list = list.map((r) => {
      const c = byEmail.get(r.email.toLowerCase());
      if (!c) return r;
      return {
        ...r,
        name: r.name ?? c.name,
        company: r.company ?? c.customer.name,
        country: r.country ?? (c.customer.country ? countryName(c.customer.country) : null),
        customerId: c.customer.id,
        contactId: c.id,
      };
    });
  }

  if (!list.length) return { ok: false, message: "没有可添加的邮箱" };
  const r = await enroll(user.tenantId, sequenceId, list);
  revalidate(sequenceId);
  return summary(r);
}
