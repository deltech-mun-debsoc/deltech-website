#!/bin/sh
# Every two minutes from cron: ask the app to send any mail that is due.
#
#   */2 * * * * /srv/mun/mailer-tick.sh >> /srv/mun/mailer.log 2>&1
#
# Runs the request from inside the app container, which already holds
# CRON_SECRET in its environment, so the secret never appears on a command line
# or in this file. The route claims every row before acting, so an overlapping
# tick, or one that lands while somebody presses Send, cannot mail anyone twice.
set -eu
cd /srv/mun
docker compose exec -T app node -e '
fetch("http://127.0.0.1:3000/api/cron/mailer", { headers: { authorization: "Bearer " + process.env.CRON_SECRET } })
  .then(async (r) => {
    const body = await r.text()
    if (r.status !== 200 || body !== "{\"started\":0,\"sent\":0,\"failed\":0,\"finished\":0,\"capped\":false}") {
      console.log(new Date().toISOString(), r.status, body)
    }
    if (!r.ok) process.exit(1)
  })
  .catch((e) => { console.error(new Date().toISOString(), e.message); process.exit(1) })
'
