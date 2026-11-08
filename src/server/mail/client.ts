import "server-only";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { decryptSecret } from "@/server/crypto";

export type MailServerConfig = {
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

type AccountRow = Omit<MailServerConfig, "password"> & { passwordEnc: string };

export function configOf(a: AccountRow): MailServerConfig {
  return { ...a, password: decryptSecret(a.passwordEnc) };
}

export function imapClient(c: MailServerConfig) {
  return new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapSecure,
    auth: { user: c.username, pass: c.password },
    logger: false,
    socketTimeout: 90_000,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  });
}

export function smtpTransport(c: MailServerConfig) {
  return nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecure,
    auth: { user: c.username, pass: c.password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
}

/** 常见邮箱的服务器预设 */
export const MAIL_PRESETS: { key: string; label: string; domains: string[]; imap: [string, number]; smtp: [string, number, boolean]; hint?: string }[] = [
  { key: "qq", label: "QQ 邮箱", domains: ["qq.com", "foxmail.com"], imap: ["imap.qq.com", 993], smtp: ["smtp.qq.com", 465, true], hint: "密码处填「授权码」：QQ 邮箱 → 设置 → 账户 → 开启 IMAP/SMTP 服务后生成" },
  { key: "exmail", label: "腾讯企业邮", domains: [], imap: ["imap.exmail.qq.com", 993], smtp: ["smtp.exmail.qq.com", 465, true], hint: "开启了安全登录时需要用「客户端专用密码」" },
  { key: "163", label: "网易 163", domains: ["163.com"], imap: ["imap.163.com", 993], smtp: ["smtp.163.com", 465, true], hint: "密码处填「授权码」：设置 → POP3/SMTP/IMAP 中开启" },
  { key: "126", label: "网易 126", domains: ["126.com"], imap: ["imap.126.com", 993], smtp: ["smtp.126.com", 465, true], hint: "密码处填「授权码」" },
  { key: "qiye163", label: "网易企业邮", domains: [], imap: ["imaphz.qiye.163.com", 993], smtp: ["smtphz.qiye.163.com", 465, true] },
  { key: "aliyun", label: "阿里企业邮", domains: [], imap: ["imap.qiye.aliyun.com", 993], smtp: ["smtp.qiye.aliyun.com", 465, true] },
  { key: "gmail", label: "Gmail", domains: ["gmail.com", "googlemail.com"], imap: ["imap.gmail.com", 993], smtp: ["smtp.gmail.com", 465, true], hint: "需开启两步验证，并在 Google 账号中生成「应用专用密码」" },
  { key: "outlook", label: "Outlook / Hotmail", domains: ["outlook.com", "hotmail.com", "live.com"], imap: ["outlook.office365.com", 993], smtp: ["smtp-mail.outlook.com", 587, false], hint: "微软个人邮箱可能已停用密码登录，建议使用企业邮箱" },
  { key: "zoho", label: "Zoho Mail", domains: ["zoho.com", "zohomail.com"], imap: ["imap.zoho.com", 993], smtp: ["smtp.zoho.com", 465, true] },
];

/** 发信后是否需要手动把邮件存到「已发送」（Gmail / Office365 会自动保存） */
export function smtpAutoSavesSent(smtpHost: string) {
  return /gmail\.com$|googlemail\.com$|office365\.com$|outlook\.com$/i.test(smtpHost);
}

/** 连接测试：IMAP 登录 + SMTP 握手，返回中文错误 */
export async function testMailConfig(c: MailServerConfig): Promise<string | null> {
  const imap = imapClient(c);
  imap.on("error", () => {});
  try {
    await imap.connect();
    await imap.logout();
  } catch (e) {
    return `收信（IMAP）连接失败：${friendlyError(e)}`;
  }
  try {
    await smtpTransport(c).verify();
  } catch (e) {
    return `发信（SMTP）连接失败：${friendlyError(e)}`;
  }
  return null;
}

export function friendlyError(e: unknown) {
  const err = e as { message?: string; responseText?: string; code?: string; authenticationFailed?: boolean };
  const msg = `${err.responseText ?? ""} ${err.message ?? ""}`.trim();
  if (err.authenticationFailed || /auth|login|password|credential|535|LOGIN failed/i.test(msg)) {
    return "账号或密码（授权码）错误，或邮箱未开启 IMAP/SMTP 服务";
  }
  if (err.code === "ENOTFOUND") return "找不到服务器地址，请检查主机名";
  if (err.code === "ECONNREFUSED") return "服务器拒绝连接，请检查端口";
  if (err.code === "ETIMEDOUT" || /timeout/i.test(msg)) return "连接超时，请检查主机名和端口";
  return msg.slice(0, 300) || "未知错误";
}
