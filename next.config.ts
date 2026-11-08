import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 后台全部是按用户的动态页面，暂不启用 cacheComponents / PPR
  output: "standalone",
  serverExternalPackages: ["@node-rs/argon2", "imapflow", "mailparser", "nodemailer", "qrcode"],
  experimental: {
    // 写邮件可以带附件
    serverActions: { bodySizeLimit: "30mb" },
    proxyClientMaxBodySize: "30mb",
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
