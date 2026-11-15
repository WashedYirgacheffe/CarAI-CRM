// 做社媒矩阵云端运行器的基础镜像（Vercel Sandbox 快照）：系统依赖 + Camoufox 浏览器内核。
// 只在升级浏览器内核时跑一次，把打印出来的快照 ID 写进 .env 的 MATRIX_SANDBOX_SNAPSHOT。
//
//   VERCEL_TOKEN=… VERCEL_TEAM_ID=… VERCEL_PROJECT_ID=… PATH=/opt/homebrew/bin:$PATH npx tsx scripts/matrix-sandbox-image.mts
//
// 需要 Node 22.19+（@vercel/sandbox 的要求）。
import "dotenv/config";
import { Sandbox } from "@vercel/sandbox";

const REGION = process.env.MATRIX_SANDBOX_REGION || "hkg1";
const creds = {
  token: process.env.VERCEL_TOKEN!,
  teamId: process.env.VERCEL_TEAM_ID!,
  projectId: process.env.VERCEL_PROJECT_ID!,
};
if (!creds.token || !creds.teamId || !creds.projectId) {
  console.error("缺少 VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID");
  process.exit(1);
}

const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString(), ...a);

const sbx = await Sandbox.create({ ...creds, region: REGION, resources: { vcpus: 2 }, timeout: 30 * 60_000, persistent: false });
log("sandbox", sbx.name, REGION);

async function run(cmd: string, sudo = false) {
  const r = await sbx.runCommand({ cmd: "bash", args: ["-lc", cmd], sudo });
  const out = (await r.stdout()) + (await r.stderr());
  if (r.exitCode !== 0) throw new Error(`${cmd}\n${out.slice(-2000)}`);
  return out;
}

try {
  log("安装系统依赖…");
  await run(
    "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libgtk-3-0t64 libdbus-glib-1-2 libasound2t64 libx11-xcb1 libxtst6 fonts-liberation fonts-noto-cjk >/dev/null",
    true,
  );
  log("安装 camoufox…");
  await run(
    `mkdir -p ~/runner && cd ~/runner && echo '{"name":"matrix-runner","private":true,"type":"module"}' > package.json && npm i -s --no-audit --no-fund camoufox@0.5.9 playwright-core@1.62.1`,
  );
  log("下载浏览器内核（约 1.3 GB）…");
  await run("cd ~/runner && npx camoufox fetch >/tmp/fetch.log 2>&1 || (tail -20 /tmp/fetch.log; exit 1)");
  log(await run("cd ~/runner && du -sh ~/.cache/camoufox node_modules && node -v"));
  log("生成快照…");
  const snap = await sbx.snapshot({ expiration: 0 });
  console.log(`\nMATRIX_SANDBOX_SNAPSHOT=${snap.snapshotId}\nMATRIX_SANDBOX_REGION=${REGION}`);
} catch (e) {
  console.error((e as Error).message);
  await sbx.stop().catch(() => {});
  process.exit(1);
}
