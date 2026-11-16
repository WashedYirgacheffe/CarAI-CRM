import { after } from "next/server";
import { kickCloud } from "@/server/matrix-cloud";
import { waitFrame } from "@/server/matrix-live";
import { liveJobFor } from "../access";

/** 同一企业 20 秒内只补拉一次云端运行器 */
const kicked = new Map<string, number>();

/**
 * 网页取实时画面：GET ?seq=<上一帧序号>，有新帧返回 JPEG，最多等 15 秒没有新帧返回 204。
 * 响应头带任务状态，任务结束后网页据此关掉画面。
 * 任务还在排队、又没有运行器在线时（比如服务器重启丢了启动请求），顺手把云端运行器拉起来。
 */
export async function GET(req: Request, ctx: RouteContext<"/api/matrix/jobs/[id]/live">) {
  const { id } = await ctx.params;
  const job = await liveJobFor(id);
  if (!job) return new Response(null, { status: 404 });
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-job-status": job.status,
    "x-account-status": job.account.status,
    "x-job-error": encodeURIComponent(job.error ?? ""),
  };
  if (!["queued", "running", "waiting"].includes(job.status)) return new Response(null, { status: 204, headers });

  if (job.status === "queued" && Date.now() - (kicked.get(job.tenantId) ?? 0) > 20_000) {
    kicked.set(job.tenantId, Date.now());
    await kickCloud(job.tenantId, job.accountId, (fn) => after(fn));
  }

  const seq = Number(new URL(req.url).searchParams.get("seq") || 0);
  const f = await waitFrame(id, seq, job.status === "queued" ? 3000 : 15_000);
  Object.assign(headers, {
    "x-seq": String(f.seq),
    "x-page-url": encodeURIComponent(f.url),
    "x-page-size": `${f.width}x${f.height}`,
    "x-file-chooser": f.chooser ? "1" : "0",
  });
  if (!f.frame) return new Response(null, { status: 204, headers });
  return new Response(new Uint8Array(f.frame), { headers: { ...headers, "content-type": "image/jpeg" } });
}
