import { redirect } from "next/navigation";

/** 日程已并入「待办」的清单 / 日历视图，旧链接直接跳过去 */
export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const { g } = await searchParams;
  redirect(typeof g === "string" && g ? `/todo?view=list&g=${encodeURIComponent(g)}` : "/todo?view=list");
}
