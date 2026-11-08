#!/usr/bin/env bash
# 每日备份：数据库 + 上传文件（含邮件附件）+ WhatsApp 登录凭证，保存在 /opt/crm/backups，保留 14 天。
# 如果 /opt/crm/.oss.env 配置了 OSS（见 README），再上传一份到阿里云 OSS 做异地备份。
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

# ── 异地备份到 OSS ──
OSS_ENV=/opt/crm/.oss.env
if [ -f "$OSS_ENV" ]; then
  set -a; . "$OSS_ENV"; set +a
fi
if [ -n "${OSS_BUCKET:-}" ]; then
  args=(--region "${OSS_REGION:-cn-hongkong}" --access-key-id "$OSS_ACCESS_KEY_ID" --access-key-secret "$OSS_ACCESS_KEY_SECRET")
  [ -n "${OSS_ENDPOINT:-}" ] && args+=(-e "$OSS_ENDPOINT")
  prefix="oss://$OSS_BUCKET/${OSS_PREFIX:-crm-backup}/$(date +%Y/%m)"
  for f in "$DIR"/*-"$STAMP".*; do
    ossutil cp "$f" "$prefix/$(basename "$f")" "${args[@]}" -f >/dev/null
  done
  echo "oss upload ok: $prefix"
fi
