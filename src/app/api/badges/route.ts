import { getCurrentUser } from "@/server/auth";
import { getBadges } from "@/server/badges";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({}, { status: 401 });
  return Response.json(await getBadges(user), { headers: { "Cache-Control": "no-store" } });
}
