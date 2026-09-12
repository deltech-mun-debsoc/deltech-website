#!/bin/bash
# Move a box to a bigger Lightsail plan with ~5 minutes of downtime and no
# reconfiguration: snapshot, launch the bigger instance from it, move the static
# IP across. The snapshot carries the Docker volumes, so the database and its
# data come with it and nothing has to be dumped, restored or re-pointed. DNS
# does not change either, because the static IP follows.
#
#   ./grow-box.sh mun-prod small_3_2 mun-prod-ip
#
# Run it from a machine with the AWS CLI and AWS_PROFILE set. Afterwards the old
# instance is left stopped, not deleted: delete it once the new one is proven.
set -euo pipefail

instance=${1:?usage: grow-box.sh <instance> <bundle-id> <static-ip-name>}
bundle=${2:?}
staticip=${3:?}
region=${AWS_REGION:-ap-southeast-2}
zone="${region}a"
stamp=$(date -u +%Y%m%d%H%M)
snapshot="${instance}-grow-${stamp}"
newname="${instance}-${stamp}"

echo "==> stopping ${instance} (the site is down from here)"
aws lightsail stop-instance --region "$region" --instance-name "$instance" >/dev/null
until [ "$(aws lightsail get-instance --region "$region" --instance-name "$instance" --query 'instance.state.name' --output text)" = stopped ]; do sleep 5; done

echo "==> snapshotting"
aws lightsail create-instance-snapshot --region "$region" --instance-name "$instance" --instance-snapshot-name "$snapshot" >/dev/null
until [ "$(aws lightsail get-instance-snapshot --region "$region" --instance-snapshot-name "$snapshot" --query 'instanceSnapshot.state' --output text)" = available ]; do sleep 15; done

echo "==> creating ${newname} on ${bundle}"
aws lightsail create-instances-from-snapshot --region "$region" \
  --instance-names "$newname" --availability-zone "$zone" \
  --instance-snapshot-name "$snapshot" --bundle-id "$bundle" >/dev/null
until [ "$(aws lightsail get-instance --region "$region" --instance-name "$newname" --query 'instance.state.name' --output text)" = running ]; do sleep 10; done

echo "==> opening ports and moving the static IP"
aws lightsail put-instance-public-ports --region "$region" --instance-name "$newname" \
  --port-infos fromPort=22,toPort=22,protocol=TCP fromPort=80,toPort=80,protocol=TCP \
               fromPort=443,toPort=443,protocol=TCP fromPort=443,toPort=443,protocol=UDP >/dev/null
aws lightsail detach-static-ip --region "$region" --static-ip-name "$staticip" >/dev/null
aws lightsail attach-static-ip --region "$region" --static-ip-name "$staticip" --instance-name "$newname" >/dev/null

cat <<NEXT

Done. The new box has the same IP, the same containers and the same data.

Still to do, by hand:
  1. ssh deploy@<ip> 'cd /srv/mun && docker compose ps'   # everything should be up
  2. Raise the limits now that there is more memory: app mem_limit and
     NODE_OPTIONS in deploy/compose.yml, then commit so the next deploy keeps them.
  3. Update DEPLOY_KNOWN_HOSTS for this environment: ssh-keyscan <ip> | gh secret set DEPLOY_KNOWN_HOSTS --env <env>
     (the host key changed with the machine, and deploys will refuse until it does)
  4. Prove it, then: aws lightsail delete-instance --instance-name ${instance}
NEXT
