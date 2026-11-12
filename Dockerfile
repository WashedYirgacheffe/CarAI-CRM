# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
# postinstall 会执行 prisma generate，需要先有 schema
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 限制 Node 堆内存：超了就构建失败退出，不会拖垮正在运行的网站
ENV SKIP_TYPECHECK=1 NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm prisma generate && pnpm build

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
EXPOSE 3000
CMD ["node", "server.js"]

# 迁移镜像：docker compose run --rm migrate
FROM build AS migrate
CMD ["pnpm", "prisma", "migrate", "deploy"]
