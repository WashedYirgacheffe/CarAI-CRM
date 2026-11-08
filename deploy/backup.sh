#!/usr/bin/env bash
# 每日备份：数据库 + 上传文件（含邮件附件）+ WhatsApp 登录凭证，保存在 /opt/crm/backups，保留 14 天。
# 产品图片、邮件附件、WhatsApp 媒体配置 OSS 后存在 OSS 上，不在这里备份。
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/opt/crm/backups
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DIR"
docker compose exec -T postgres pg_dump -U crm -d cheche_crm -Fc > "$DIR/db-$STAMP.dump"
docker run --rm -v crm_uploads:/data:ro -v "$DIR":/out alpine tar czf "/out/uploads-$STAMP.tgz" -C /data .
# WhatsApp 登录凭证（丢失只需重新登录）
docker run --rm -v crm_whatsapp:/data:ro -v "$DIR":/out alpine tar czf "/out/whatsapp-$STAMP.tgz" -C /data . || true
find "$DIR" -type f -mtime +14 -delete
echo "backup ok: $STAMP"

