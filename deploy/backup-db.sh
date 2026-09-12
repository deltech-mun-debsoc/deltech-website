#!/bin/sh
# Hourly dump of this box's database to S3, run from cron (see docs/AWS.md).
#
# The database is small (tens of MB), so a full custom-format dump every hour
# costs pennies and restores in seconds. This is what replaces the managed
# service's point-in-time restore: the exposure is up to one hour of writes.
#
# Restore:
#   aws s3 cp s3://<bucket>/backups/<db>/<file> .
#   gunzip -c <file> | docker exec -i $(docker compose ps -q db) \
#     pg_restore --clean --if-exists -U postgres -d <db>
set -eu
cd /srv/mun

db=$(sed -n 's/^APP_DB_NAME=//p' app.env)
bucket=$(sed -n 's/^S3_BUCKET=//p' app.env)
AWS_ACCESS_KEY_ID=$(sed -n 's/^AWS_ACCESS_KEY_ID=//p' app.env)
AWS_SECRET_ACCESS_KEY=$(sed -n 's/^AWS_SECRET_ACCESS_KEY=//p' app.env)
AWS_DEFAULT_REGION=$(sed -n 's/^S3_REGION=//p' app.env)
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION

stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/tmp/${db}-${stamp}.pgcustom.gz"

docker compose exec -T db pg_dump -U postgres --no-owner --no-privileges \
  --format=custom "$db" | gzip > "$file"

# An empty or truncated dump is worse than none: it looks like a backup.
size=$(wc -c < "$file")
if [ "$size" -lt 10000 ]; then
  echo "refusing to upload a ${size}-byte dump of $db" >&2
  rm -f "$file"
  exit 1
fi

docker run --rm -v /tmp:/t \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION \
  amazon/aws-cli s3 cp "/t/$(basename "$file")" \
  "s3://${bucket}/backups/${db}/$(basename "$file")" >/dev/null

rm -f "$file"
echo "$(date -u +%FT%TZ) $db backed up (${size} bytes)"
