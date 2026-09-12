#!/bin/bash
# Hand every object in public over to the app role.
#
# pg_restore ran as the superuser, so the tables came back owned by postgres and
# the app could read nothing ("permission denied for table Setting"). Prisma
# migrations also need to ALTER these tables, so ownership is the right fix
# rather than a pile of GRANTs.
set -euo pipefail
cd /srv/mun
db=$(sed -n 's/^APP_DB_NAME=//p' app.env)

docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -d "$db" <<SQL
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '$db');
  END LOOP;
  FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', r.sequencename, '$db');
  END LOOP;
  FOR r IN SELECT table_name FROM information_schema.views WHERE table_schema = 'public' LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO %I', r.table_name, '$db');
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO %I', r.typname, '$db');
  END LOOP;
END
\$\$;
SQL

echo "$db: $(docker compose exec -T db psql -U postgres -qtA -d "$db" -c "select count(*) from pg_tables where schemaname='public' and tableowner='$db'") tables now owned by the app role"
