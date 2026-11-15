import { waitFrame } from "@/server/matrix-live";
import { liveJobFor } from "../access";

/**
 * 网页取实时画面：GET ?seq=<上一帧序号>，有新帧返回 JPEG，最多等 15 秒没有新帧返回 204。
 * 响应头带任务状态，任务结束后网页据此关掉画面。
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
  const seq = Number(new URL(req.url).searchParams.get("seq") || 0);
  const f = await waitFrame(id, seq, job.status === "queued" ? 3000 : 15_000);
  Object.assign(headers, { "x-seq": String(f.seq), "x-page-url": encodeURIComponent(f.url), "x-page-size": `${f.width}x${f.height}` });
  if (!f.frame) return new Response(null, { status: 204, headers });
  return new Response(new Uint8Array(f.frame), { headers: { ...headers, "content-type": "image/jpeg" } });
}
