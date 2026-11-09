import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { globalSearch } from "@/server/search";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json([], { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return Response.json(await globalSearch(user, q), { headers: { "Cache-Control": "no-store" } });
}
