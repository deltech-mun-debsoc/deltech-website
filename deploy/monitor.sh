#!/bin/sh
# Daily health check for one box, emailed only when something is wrong.
#
# Supabase watched the database for us: disk, uptime, backup success. Nobody
# watches it now, and the failure mode of a self-hosted database is silent --
# the backup cron stops working, or the disk fills, and you find out when you
# need the backup. This is the smallest thing that would have caught either.
#
# Cron:  30 2 * * *  /srv/mun/monitor.sh
set -eu
cd /srv/mun

problems=""
note() { problems="${problems}- $1\n"; }

# 1. Is there a recent backup, and is it a plausible size?
db=$(sed -n 's/^APP_DB_NAME=//p' app.env)
bucket=$(sed -n 's/^S3_BUCKET=//p' app.env)
AWS_ACCESS_KEY_ID=$(sed -n 's/^AWS_ACCESS_KEY_ID=//p' app.env)
AWS_SECRET_ACCESS_KEY=$(sed -n 's/^AWS_SECRET_ACCESS_KEY=//p' app.env)
AWS_DEFAULT_REGION=$(sed -n 's/^S3_REGION=//p' app.env)
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION

latest=$(docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  amazon/aws-cli s3 ls "s3://${bucket}/backups/${db}/" 2>/dev/null | sort | tail -1 || true)
if [ -z "$latest" ]; then
  note "No backup of ${db} in s3://${bucket}/backups/ at all."
else
  stamp=$(echo "$latest" | awk '{print $1" "$2}')
  age_h=$(( ( $(date -u +%s) - $(date -u -d "$stamp" +%s) ) / 3600 ))
  size=$(echo "$latest" | awk '{print $3}')
  [ "$age_h" -gt 3 ] && note "Newest backup of ${db} is ${age_h}h old (hourly cron may have stopped)."
  [ "$size" -lt 10000 ] && note "Newest backup of ${db} is only ${size} bytes."
fi

# 2. Disk. A full disk stops Postgres writing and is not obvious until it is.
used=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
[ "$used" -gt 80 ] && note "Disk is ${used}% full."

# 3. Are the containers actually up?
for svc in caddy app db; do
  state=$(docker compose ps --format '{{.Service}} {{.State}}' | awk -v s="$svc" '$1==s {print $2}')
  [ "$state" = "running" ] || note "Container ${svc} is '${state:-missing}', not running."
done

[ -z "$problems" ] && { echo "$(date -u +%FT%TZ) all clear"; exit 0; }

# Something is wrong: say so by email. Resend is used directly rather than the
# app, so this still works when the app is the thing that is down.
key=$(sed -n 's/^AUTH_RESEND_KEY=//p' app.env)
from=$(sed -n 's/^EMAIL_FROM=//p' app.env)
to=$(sed -n 's/^ADMIN_EMAIL=//p' app.env)
host=$(hostname)
body=$(printf "%b" "$problems")
echo "$(date -u +%FT%TZ) PROBLEMS on ${host}:"
echo "$body"

if [ -n "$key" ] && [ -n "$to" ]; then
  payload=$(printf '{"from":"%s","to":"%s","subject":"[%s] box health check failed","text":%s}' \
    "$from" "$to" "$host" "$(printf '%s' "$body" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")
  curl -fsS -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \
    -d "$payload" >/dev/null && echo "alert emailed to ${to}"
fi
exit 1
