// 后台 worker：邮件定时同步 + 新邮件 AI 分析 + WhatsApp 会话 + 公海回收。
// 本地：pnpm worker；Docker：worker 服务（见 docker-compose.yml）
import "dotenv/config";
import { prisma } from "@/server/db";
import { syncMailAccount } from "@/server/mail/sync";
import { aiConfigured, analyzeMail } from "@/server/ai";
import { recyclePool } from "@/server/pool";
import { reconcileWhatsapp, refreshWaAvatars, shutdownWhatsapp } from "@/server/whatsapp/runtime.mjs";

const MAIL_EVERY = Number(process.env.MAIL_SYNC_MINUTES || 3) * 60_000;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function every(ms: number, name: string, fn: () => Promise<void>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      log(`[${name}]`, "error", (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}

async function syncMail() {
  const now = Date.now();
  const accounts = await prisma.mailAccount.findMany({
    where: { status: { not: "PAUSED" } },
    select: { id: true, email: true, status: true, lastSyncAt: true },
  });
  // 连接失败的邮箱降频到 15 分钟一次
  const due = accounts.filter((a) => !a.lastSyncAt || now - a.lastSyncAt.getTime() >= (a.status === "ERROR" ? 15 * 60_000 : MAIL_EVERY - 5_000));
  for (let i = 0; i < due.length; i += 4) {
    const batch = due.slice(i, i + 4);
    const results = await Promise.all(batch.map((a) => syncMailAccount(a.id)));
    results.forEach((r, j) => {
      if (r.added || !r.ok) log("[mail]", batch[j].email, r.ok ? `+${r.added}` : r.error);
    });
  }
}

async function analyzeNewMail() {
  if (!aiConfigured()) return;
  const rows = await prisma.mailMessage.findMany({
    where: { folder: "INBOX", aiAnalyzedAt: null, date: { gt: new Date(Date.now() - 3 * 86_400_000) } },
    orderBy: { date: "desc" },
    take: 8,
    select: { id: true, fromAddr: true, fromName: true, subject: true, text: true, snippet: true },
  });
  for (const m of rows) {
    try {
      const r = await analyzeMail({ from: `${m.fromName ?? ""} <${m.fromAddr}>`, subject: m.subject, text: m.text ?? m.snippet });
      await prisma.mailMessage.update({
        where: { id: m.id },
        data: { aiSummary: r.summary, aiIntent: r.intent, aiPriority: r.priority, aiAnalyzedAt: new Date() },
      });
    } catch (e) {
      // 失败也打上时间，避免反复重试同一封
      await prisma.mailMessage.update({ where: { id: m.id }, data: { aiAnalyzedAt: new Date() } });
      log("[ai]", "analyze failed", (e as Error).message);
    }
  }
}

async function recycle() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  for (const t of tenants) {
    const n = await recyclePool(t.id);
    if (n) log("[pool]", `${t.name}: 回收 ${n} 个客户`);
  }
}

log("worker started");
const timers = [
  every(30_000, "mail", syncMail),
  every(60_000, "ai", analyzeNewMail),
  every(3_000, "wa", reconcileWhatsapp),
  every(20_000, "wa-avatar", refreshWaAvatars),
  every(60 * 60_000, "pool", recycle),
];

async function stop() {
  log("worker stopping");
  timers.forEach(clearInterval);
  shutdownWhatsapp();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
