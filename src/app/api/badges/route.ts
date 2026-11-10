import { getCurrentUser } from "@/server/auth";
import { getBadges, getDueReminders } from "@/server/badges";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({}, { status: 401 });
  const [badges, due] = await Promise.all([getBadges(user), getDueReminders(user)]);
  return Response.json({ ...badges, due }, { headers: { "Cache-Control": "no-store" } });
}
