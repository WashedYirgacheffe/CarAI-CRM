/** web 进程启动时执行一次：起社媒矩阵的定时任务（任务超时、定时检查登录）。只在生产环境跑 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" && process.env.MATRIX_SCHEDULER !== "1") return;
  if (process.env.MATRIX_SCHEDULER === "0") return;
  const { startMatrixScheduler } = await import("@/server/matrix-schedule");
  startMatrixScheduler();
}
