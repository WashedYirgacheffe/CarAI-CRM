import "server-only";
import { getObject } from "@/server/storage";

export type DesktopReleaseInfo = {
  version: string | null;
  releaseDate: string | null;
  sizeMb: number | null;
  available: boolean;
};

export type DesktopReleases = {
  win: DesktopReleaseInfo;
  macArm64: DesktopReleaseInfo;
  macX64: DesktopReleaseInfo;
};

let cache: { at: number; data: DesktopReleases } | null = null;
const TTL_MS = 5 * 60_000;

function parseYml(raw: string | null, archHint?: "arm64" | "x64"): DesktopReleaseInfo {
  if (!raw) return { version: null, releaseDate: null, sizeMb: null, available: false };
  const version = /^version:\s*(\S+)/m.exec(raw)?.[1] ?? null;
  const releaseDateRaw = /^releaseDate:\s*['"]?([^'"\n]+)['"]?/m.exec(raw)?.[1] ?? null;
  const releaseDate = releaseDateRaw ? releaseDateRaw.slice(0, 10) : null;

  let sizeBytes: number | null = null;
  const fileBlocks = raw.split(/\n\s*-\s+url:\s*/).slice(1);
  if (fileBlocks.length > 0) {
    const picked = archHint
      ? fileBlocks.find((b) => b.includes(`-${archHint}-`) && /\.(?:dmg|exe)\b/.test(b.split("\n")[0] ?? "")) ??
        fileBlocks.find((b) => /\.(?:dmg|exe)\b/.test(b.split("\n")[0] ?? "")) ??
        fileBlocks[0]
      : fileBlocks.find((b) => /\.(?:exe|dmg)\b/.test(b.split("\n")[0] ?? "")) ?? fileBlocks[0];
    const m = /size:\s*(\d+)/.exec(picked);
    if (m) sizeBytes = Number(m[1]);
  }

  return {
    version,
    releaseDate,
    sizeMb: sizeBytes ? Math.round(sizeBytes / 1048576) : null,
    available: !!version,
  };
}

/** 从 OSS 读取最新桌面版清单（5 分钟内存缓存），供落地页下载中心动态展示 */
export async function getDesktopReleases(): Promise<DesktopReleases> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const [winBuf, macBuf] = await Promise.all([
    getObject("desktop/latest.yml").catch(() => null),
    getObject("desktop/latest-mac.yml").catch(() => null),
  ]);
  const winRaw = winBuf ? winBuf.toString("utf8") : null;
  const macRaw = macBuf ? macBuf.toString("utf8") : null;
  const data: DesktopReleases = {
    win: parseYml(winRaw),
    macArm64: parseYml(macRaw, "arm64"),
    macX64: parseYml(macRaw, "x64"),
  };
  cache = { at: Date.now(), data };
  return data;
}
