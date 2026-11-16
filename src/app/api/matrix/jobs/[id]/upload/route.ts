import { MAX_UPLOAD_BYTES, pushInput, putFiles } from "@/server/matrix-live";
import { liveJobFor } from "../access";

/**
 * 实时画面里上传本机文件（图片、视频等）：先放内存，排一个 upload 输入给运行器，
 * 运行器下载后塞给网页的文件选择框（网页已经弹了选择框就直接用，没弹就等下一次弹出）。
 */
export async function POST(req: Request, ctx: RouteContext<"/api/matrix/jobs/[id]/upload">) {
  const { id } = await ctx.params;
  const job = await liveJobFor(id);
  if (!job || !["running", "waiting"].includes(job.status)) return Response.json({ error: "画面已经结束" }, { status: 404 });
  const fd = await req.formData().catch(() => null);
  const files = (fd?.getAll("file") ?? []).filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
  if (!files.length) return Response.json({ error: "没有文件" }, { status: 400 });
  const size = files.reduce((n, f) => n + f.size, 0);
  if (size > MAX_UPLOAD_BYTES) return Response.json({ error: `文件太大，一次最多 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` }, { status: 413 });
  const stored = putFiles(
    id,
    await Promise.all(files.map(async (f) => ({ name: f.name.slice(0, 200) || "file", type: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()) }))),
  );
  pushInput(id, { t: "upload", files: stored });
  return Response.json({ ok: true, files: stored.length });
}
