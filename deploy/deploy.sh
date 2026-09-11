#!/bin/sh
# Switch one service to an image already loaded on this box, and switch back if
# it does not come up healthy. Run by .github/workflows/deploy.yml, or by hand to
# roll back:  /srv/mun/deploy.sh prod <older-sha>
set -eu
svc=$1
sha=$2
case "$svc" in
  prod) var=PROD_TAG ;;
  staging) var=STAGING_TAG ;;
  *) echo "usage: deploy.sh prod|staging <sha>" >&2; exit 2 ;;
esac
cd /srv/mun
touch .env

docker image inspect "mun:$svc-$sha" >/dev/null
prev=$(sed -n "s/^$var=//p" .env)

set_tag() {
  sed -i "/^$var=/d" .env
  echo "$var=$1" >> .env
  docker compose up -d --no-deps "$svc"
}

healthy() {
  i=0
  while [ $i -lt 45 ]; do
    status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q "$svc")" 2>/dev/null || echo starting)
    [ "$status" = healthy ] && return 0
    i=$((i + 1))
    sleep 2
  done
  return 1
}

# ponytail: recreating the container drops requests for the ~10s Next takes to
# boot; run two replicas behind Caddy if that ever matters.
set_tag "$sha"
if ! healthy; then
  echo "mun:$svc-$sha did not become healthy" >&2
  docker compose logs --tail 50 "$svc" >&2
  if [ -n "$prev" ] && [ "$prev" != "$sha" ]; then
    echo "rolling back to $prev" >&2
    set_tag "$prev"
  fi
  exit 1
fi

# Keep the five newest images of this service for rollbacks.
docker images mun --format '{{.CreatedAt}}\t{{.Tag}}' \
  | grep "	$svc-" | sort -r | tail -n +6 | cut -f2 \
  | xargs -r -I{} docker rmi "mun:{}" >/dev/null
echo "$svc is on $sha"
