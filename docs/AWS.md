# Hosting on AWS

Production and staging each run on their own Lightsail box behind Caddy, sharing
one managed Postgres instance. Media is S3, email is SES, and realtime is our own
in-process SSE bus. There is no Supabase.

```text
Registrar DNS ──┬─► mun-prod    box (Sydney, 1 GB, $7/mo)  Caddy → app
                │      deltechmun.in → 301 www.deltechmun.in
                └─► mun-staging box (Sydney, 1 GB, $7/mo)  Caddy → app
                       test.deltechmun.in (noindex)
                  Lightsail managed Postgres (private, same region)
                  S3  deltechmun-media-prod / -staging (ap-south-1)
                  SES deltechmun.in (ap-south-1)
```

Why this shape: Next 16.3 has no proven serverless adapter on AWS yet, while a
plain Node server is fully supported. One process per environment also keeps the
quiz cache (`unstable_cache` + `updateTag`, `src/lib/quiz-cache.ts`) and the
realtime bus (`src/lib/realtime/bus.ts`) correct; a second instance of either
environment would need a shared cache and an external bus first.

A box each rather than two containers on one box: a new AWS account is capped at
the 1 GB plan, and 1 GB cannot hold both. It is also better isolation, for $2 more
than the single 2 GB box would have cost.

The box holds no data. Losing it means rebuilding it from this document, not
restoring anything.

## Deploys

| Push to | Builds | Lands on |
| --- | --- | --- |
| `staging` | `mun:staging-<sha>` with the `staging` GitHub Environment | `mun-staging` box → test.deltechmun.in |
| `main` | `mun:prod-<sha>` with the `production` GitHub Environment | `mun-prod` box → www.deltechmun.in |

`DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` are **Environment** secrets, so a branch
can only ever reach its own box.

`.github/workflows/deploy.yml` builds on the runner, streams the image over SSH,
and runs `deploy/deploy.sh`, which switches the container and switches back if
it is not healthy within 90 s. Each push also syncs its own box's `deploy/` files (`Caddyfile.<env>`, compose,
deploy.sh). The workflow is inert until the repo variable `AWS_DEPLOY=true`.

Migrations are unchanged: staging's apply automatically (`staging-migrate.yml`),
production's by hand, first. See [CI.md](CI.md).

**Rollback.** The box keeps the last five images per environment.

```bash
ssh deploy@<box> /srv/mun/deploy.sh prod <older-sha>
```

Or run the Deploy workflow by hand with that SHA. Code only; the schema does not
roll back.

**Logs.** `ssh deploy@<box>`, then `cd /srv/mun && docker compose logs -f prod`.

## Environment variables

`NEXT_PUBLIC_*` and `APP_ENV` are baked in at build time from the GitHub
Environment (`production` / `staging`) variable `NEXT_PUBLIC_APP_URL`. The image
derives `AUTH_URL` from `NEXT_PUBLIC_APP_URL` and sets `AUTH_TRUST_HOST=true`;
both are required off Vercel.

Runtime secrets live only on the box, mode 600, one per line `KEY=value`:

- `/srv/mun/app.env` on each box: `APP_ENV`, `DATABASE_URL`, `DIRECT_URL`,
  `DATABASE_POOL_MAX=5`, `AUTH_SECRET` (different per environment),
  `EMAIL_TRANSPORT`, `AUTH_RESEND_KEY`, `EMAIL_FROM`, `SES_REGION`,
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `RAZORPAY_*`, `ADMIN_EMAIL`,
  `CRON_SECRET`, `GFORM_SHARED_SECRET`, `SHEET_SYNC_SECRET`, `GROQ_API_KEY`,
  `UPI_VPA`, `UPI_PAYEE_NAME`. Staging adds `EMAIL_REDIRECT_TO`.
- `/srv/mun/caddy.env`: `ACME_EMAIL`.

After editing an env file: `docker compose up -d prod` (or `staging`).

GitHub, repo level: secrets `DEPLOY_HOST`, `DEPLOY_SSH_KEY`,
`DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <box>`), `CRON_SECRET` (production's);
variables `AWS_DEPLOY`, `CRON_ENABLED`.

## Crons

`.github/workflows/cron.yml` calls the three cron routes on production at the
same UTC times `vercel.json` did, once `CRON_ENABLED=true`. Flip that at the
production cutover, when the Vercel project stops running them. Any job can be
run by hand from the Actions tab.

## One-time setup

### 1. Account (owner, ~30 min)

1. Sign up with the society's email, **Paid plan** (the Free plan closes the
   account after six months; credits apply either way). Turn on root MFA.
2. Billing → Budgets → monthly cost budget, $20, email alert.
3. IAM Identity Center → enable → create your user with
   `AdministratorAccess`. Stop using root.
4. SES (region **Mumbai, ap-south-1**) → Get set up → request production
   access. Use case: transactional email for event registrations and sign-in
   links, a few hundred a month, bounces handled by monitoring EmailLog.

### 2. Box

Three things that cost time the first time:

- A **new account is capped at the 1 GB Lightsail plan**; the 2 GB one is refused with "your account can not create an instance using this Lightsail plan size". It is not in Service Quotas (the `Instances` row there is a count). Open a support case: Service **Lightsail**, region Sydney, asking for the larger plan sizes.
- `lightsail import-key-pair --public-key-base64` actually wants the **raw** `ssh-ed25519 AAAA...` text, not base64. Real base64 is rejected as "not valid".
- Compose **interpolates `$` in env_file values** by default, which silently empties anything containing `$`. Env files are therefore loaded with `format: raw` (see deploy/compose.yml).

1. Generate the deploy key locally: `ssh-keygen -t ed25519 -f mun-deploy -N ""`.
2. Lightsail → Create instance → **Sydney**, Linux, Ubuntu 24.04, the
   $12 plan (2 GB). Paste `deploy/bootstrap.sh` into "launch script" with
   `mun-deploy.pub` filled in.
3. Networking → attach a static IP. Firewall: 22, 80, 443 (add 443/UDP for HTTP/3).
4. Metrics → alarms: CPU > 80% for 10 min, and status check failed, to your email.
5. Copy `deploy/compose.yml`, `deploy/Caddyfile` and `deploy/deploy.sh` to
   `/srv/mun/`, write the three env files, then `docker compose up -d caddy`.

### 3. S3

Per environment, a bucket (`deltechmun-media-prod`, `deltechmun-media-staging`)
in ap-south-1 with ACLs disabled. Public objects are read through a bucket
policy limited to the public prefixes; recruitment documents are never public
and are served by signed URL.

Bucket policy (Block Public Access must allow bucket policies):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": [
      "arn:aws:s3:::deltechmun-media-prod/posts/*",
      "arn:aws:s3:::deltechmun-media-prod/covers/*",
      "arn:aws:s3:::deltechmun-media-prod/team/*"
    ]
  }]
}
```

CORS (browsers upload straight to S3):

```json
[{
  "AllowedOrigins": ["https://www.deltechmun.in"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["*"],
  "MaxAgeSeconds": 3000
}]
```

Staging's bucket uses `https://test.deltechmun.in` and its own name.

### 4. SES

Verified identities → create → domain `deltechmun.in`, Easy DKIM (RSA 2048),
custom MAIL FROM `mail.deltechmun.in`. Add the three DKIM CNAMEs, the MAIL FROM
MX and TXT, and a DMARC TXT (`_dmarc`, `v=DMARC1; p=none; rua=mailto:<society email>`)
at the registrar. Keep the Resend records until SES is proven.

### 5. IAM (one user per environment)

Access key for the app, with only this inline policy (swap the bucket name for
staging). Put the key in both the `AWS_*` and `S3_*` variables of that env file.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::deltechmun-media-prod/*" },
    { "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:ap-south-1:<account-id>:identity/deltechmun.in" }
  ]
}
```

Lightsail instances cannot assume IAM roles, so static keys are unavoidable
here. Rotate: create a second key, update the env file, `docker compose up -d`,
delete the old key.

## Cutover

**Staging first:** point `test` (A record) at the static IP, set
`AWS_DEPLOY=true`, push to `staging`, walk the site (sign-in both ways, ribbon,
upload, email to the sink, form sync, a quiz load test with `scripts/load-quiz.ts` against staging only while watching
`docker stats`). Then remove the `staging` branch from Vercel.

**Production:**

1. A day ahead, lower the TTL on `@` and `www` to 300.
2. Push `main`; smoke-test through `/etc/hosts` (`<ip> www.deltechmun.in`).
3. Flip `@` and `www` to the static IP. Caddy issues certificates within a minute.
4. Set `EMAIL_TRANSPORT=ses` in `prod.env` once SES production access is granted,
   `docker compose up -d prod`, send yourself a magic link.
5. Set `CRON_ENABLED=true`; remove the crons from Vercel.
6. Watch `docker compose logs -f prod` for an hour. Keep the Vercel project for a
   week as a fallback (flip DNS back). Then delete `vercel.json`, `build:vercel`,
   the `VERCEL_ENV` fallbacks and the Resend records.

## Rebuilding the box

Create a new instance (section 2), move the static IP to it, copy the env files
from your password manager, run the Deploy workflow for `main` and `staging`.
About 15 minutes; nothing else lives there.
