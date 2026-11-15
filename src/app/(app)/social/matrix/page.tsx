import type { Metadata } from "next";
import { PlannedModule } from "@/components/planned-module";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = { title: "社媒矩阵" };

/** 多账号聚合管理（指纹浏览器 + IP 封装）：方案讨论中，见 docs/social-matrix-plan.md */
export default async function SocialMatrixPage() {
  await requireUser();
  return (
    <PlannedModule
      title="社媒矩阵"
      phase="方案讨论"
      features={[
        "团队社媒账号统一托管：账号、密码、二次验证加密保存，按人 / 部门分配，离职一键交接",
        "每个账号一个独立浏览器环境（指纹隔离：Cookie、UA、时区、Canvas / WebGL 等），一键打开",
        "每个账号绑定固定的住宅 / 静态代理 IP，定时检查连通和黑名单",
        "用观察号读取重点客户的 LinkedIn / Instagram 动态，补上「社媒动态」里要登录才能看的平台",
        "LinkedIn / Messenger / Instagram 私信回流到客户跟进时间线",
        "操作审计：谁在什么时候打开了哪个账号",
      ]}
    />
  );
}
