import { z } from "zod";
import { pushInput } from "@/server/matrix-live";
import { LIVE_KEYS } from "@/lib/matrix";
import { liveJobFor } from "../access";

const unit = z.number().min(0).max(1);
const Input = z.discriminatedUnion("t", [
  z.object({ t: z.enum(["click", "dblclick"]), x: unit, y: unit }),
  z.object({ t: z.literal("wheel"), dy: z.number().min(-5000).max(5000) }),
  z.object({ t: z.literal("type"), text: z.string().min(1).max(500) }),
  z.object({ t: z.literal("key"), key: z.enum(LIVE_KEYS) }),
  z.object({ t: z.literal("back") }),
  z.object({ t: z.literal("resize"), w: z.number().int().min(320).max(2560), h: z.number().int().min(320).max(1600) }),
]);

/** 网页上的点击、滚动、输入，排队等运行器取走 */
export async function POST(req: Request, ctx: RouteContext<"/api/matrix/jobs/[id]/input">) {
  const { id } = await ctx.params;
  const job = await liveJobFor(id);
  if (!job || !["running", "waiting"].includes(job.status)) return Response.json({ ok: false }, { status: 404 });
  const parsed = Input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  pushInput(id, parsed.data);
  return Response.json({ ok: true });
}
