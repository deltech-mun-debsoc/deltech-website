# CI, AWS deployments and health

GitHub Actions is the only deployment system.

```text
pull request     → CI: checks + production build; no deployment
push to staging  → AWS staging deployment + automatic staging migration
push to main     → AWS production deployment; production migration is manual
every 30 minutes → AWS health checks for both public hosts and databases
```

There are no per-PR websites. A feature branch cannot select a GitHub
Environment, read a server address or deploy.

## Workflows

| Name | Trigger | Purpose |
| --- | --- | --- |
| **CI** | Pull request or manual | Runs `npm run check` and a production build. |
| **AWS deploy** | Push to `staging` or `main`, or manual rollback | Builds the Docker image, ships it over SSH, switches only after container health succeeds, then verifies HTTPS and the database through Caddy. |
| **AWS health** | Every 30 minutes or manual | Calls `/api/health` on both sites and verifies the expected environment and database. |
| **Staging migrate** | Schema change pushed to `staging`, or manual | Applies Prisma migrations through an SSH tunnel to `mun_staging`. |
| **Staging seed** | Manual with `RESET` confirmation | Wipes and repopulates the staging database. |
| **Cron (production)** | Scheduled or manual | Calls production cron endpoints once `CRON_ENABLED=true`. |

The deploy and health runs write a plain-English result to the GitHub Actions
summary: environment, host, commit, container, database and HTTPS status.

## Deployment safety

The Docker image contains `APP_ENV`, `NEXT_PUBLIC_APP_URL` and `APP_VERSION`.
Runtime secrets remain in `/srv/mun/app.env` on the corresponding server.
GitHub Environment secrets contain only that environment's server address and
host key, so staging cannot reach production.

`deploy/deploy.sh` keeps the previous five images. If the new image does not
become healthy within 90 seconds it switches back automatically. The health
endpoint performs a real database query; a responsive sign-in page with a
broken database does not count as healthy.

Manual rollback:

```bash
ssh deploy@<box> /srv/mun/deploy.sh prod <older-sha>
```

This rolls back code only. Database schemas do not roll back.

## Migrations

Staging migrations are automatic. Production migrations remain manual:

```bash
ssh -f -N -L 55432:127.0.0.1:5432 deploy@<production-box>
DIRECT_URL='postgresql://mun_prod:<password>@127.0.0.1:55432/mun_prod' npm run db:deploy
```

Apply a production migration before deploying code that requires it. Prefer
additive changes and expand/contract for destructive changes.

## Environment variables

`NEXT_PUBLIC_APP_URL` is a GitHub Environment variable and is baked into the
image. Changing it requires a deployment. `AUTH_URL` is derived from it in the
Dockerfile because the standalone server otherwise sees its bind address.

See [AWS.md](AWS.md) for infrastructure and [STAGING.md](STAGING.md) for the
test environment.

## Recruitment checks

The recruitment module keeps its decision logic in pure functions under
`src/lib/recruitment/`. `npm run check` covers permissions, transitions,
sessions, imports, guards and media keys.

`check-recruitment-concurrency.ts` needs a writable scratch Postgres database
and is disabled unless explicitly requested:

```bash
RECRUITMENT_DB_CHECKS=1 DIRECT_URL=postgresql://.../scratch npx tsx scripts/check-recruitment-concurrency.ts
```
