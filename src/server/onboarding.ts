import "server-only";
import { prisma } from "@/server/db";
import { can, type CurrentUser } from "@/server/auth";

export type OnboardingStep = { key: string; title: string; why: string; href: string; cta: string; done: boolean };

/**
 * 新用户上手清单：绑邮箱、连 WhatsApp、导入客户、添加产品。
 * 按权限只列自己能做的；全部完成或用户收起后返回 null
 */
export async function getOnboarding(user: CurrentUser): Promise<OnboardingStep[] | null> {
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { onboardingOff: true } });
  if (!me || me.onboardingOff) return null;
  const t = user.tenantId;
  const canMail = can(user, "mail.use");
  const canWa = can(user, "whatsapp.use");
  const canCustomer = can(user, "customer.create");
  const canProduct = can(user, "product.manage");
  const [mail, wa, customers, products] = await Promise.all([
    canMail ? prisma.mailAccount.count({ where: { tenantId: t, userId: user.id } }) : 0,
    canWa ? prisma.waAccount.count({ where: { tenantId: t, userId: user.id, status: "CONNECTED" } }) : 0,
    canCustomer ? prisma.customer.count({ where: { tenantId: t, ownerId: user.id } }) : 0,
    canProduct ? prisma.product.count({ where: { tenantId: t } }) : 0,
  ]);
  const steps: (OnboardingStep | false)[] = [
    canMail && {
      key: "mail",
      title: "绑定工作邮箱",
      why: "来信自动同步、AI 自动分拣和翻译，客户来信自动建档",
      href: "/settings/mailboxes",
      cta: "去绑定",
      done: mail > 0,
    },
    canWa && {
      key: "wa",
      title: "连接 WhatsApp",
      why: "扫码登录后在电脑上聊天，外文消息自动翻译成中文",
      href: "/settings/whatsapp",
      cta: "去连接",
      done: wa > 0,
    },
    canCustomer && {
      key: "customers",
      title: "导入客户",
      why: mail > 0 ? "从邮件往来里一键建档，或手动新建客户" : "新建客户，或绑好邮箱后从邮件往来里一键建档",
      href: mail > 0 ? "/customers/suggestions" : "/customers",
      cta: "去导入",
      done: customers > 0,
    },
    canProduct && {
      key: "products",
      title: "添加产品",
      why: "做报价单、在 WhatsApp 里发产品卡片时直接选，AI 起草也会引用真实价格",
      href: "/products",
      cta: "去添加",
      done: products > 0,
    },
  ];
  const list = steps.filter((s): s is OnboardingStep => !!s);
  if (!list.length || list.every((s) => s.done)) return null;
  return list;
}
