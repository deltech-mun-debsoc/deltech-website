#!/bin/sh
# One-time setup for a fresh Lightsail Ubuntu 24.04 instance. Paste into the
# instance's "launch script" box (runs as root on first boot), with the deploy
# public key filled in. Everything after this arrives via deploy.yml.
set -eu
DEPLOY_PUBKEY='REPLACE_WITH_THE_DEPLOY_PUBLIC_KEY'

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 unattended-upgrades
systemctl enable --now docker
dpkg-reconfigure -f noninteractive unattended-upgrades

# Headroom for a 2 GB box: a build never runs here, but a traffic spike should
# slow down rather than get OOM-killed.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# The CI user. Membership of the docker group is root-equivalent; the only key
# allowed in is the one GitHub Actions holds.
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "$DEPLOY_PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /srv/mun
