import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 后台全部是按用户的动态页面，暂不启用 cacheComponents / PPR
  output: "standalone",
  // 服务器（2 核 3.5G）构建时跳过类型检查：提交前已在本地跑过 tsc，服务器再跑一遍会把内存吃满、整机卡死
  typescript: { ignoreBuildErrors: process.env.SKIP_TYPECHECK === "1" },
  serverExternalPackages: ["@node-rs/argon2", "imapflow", "mailparser", "nodemailer", "qrcode"],
  experimental: {
    // 写邮件可以带附件
    serverActions: { bodySizeLimit: "30mb" },
    proxyClientMaxBodySize: "30mb",
    // 服务器在香港，国内访问往返一次就要几百毫秒：
    // 30 秒内回到刚看过的页面直接用浏览器里的结果（保存、操作后会自动刷新，不会看到旧数据）；
    // 各页面的加载骨架 30 分钟内不重复预取
    staleTimes: { dynamic: 30, static: 1800 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
