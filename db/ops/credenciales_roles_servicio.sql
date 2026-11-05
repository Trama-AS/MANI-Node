-- =====================================================================
-- Credenciales de los roles de servicio (SCRUM-1468 / TEC-21, ADR-0031 §5)
--
-- Lo corre operaciones (DevOps) una vez por ambiente, con el usuario dueño
-- del esquema (`postgres`), DESPUÉS de aplicar la migración 0037. Da LOGIN a
-- `mani_core_svc` y `mani_dispatch_svc` con una contraseña que llega como
-- variable de psql: la contraseña no queda en este archivo, ni en git, ni en
-- el historial de la shell si se lee de un archivo protegido.
--
--   psql "$URL_ADMIN" -v ON_ERROR_STOP=1 \
--        -v core_password="$(cat /opt/mani/secrets/mani_core_svc)" \
--        -v dispatch_password="$(cat /opt/mani/secrets/mani_dispatch_svc)" \
--        -f db/ops/credenciales_roles_servicio.sql
--
-- Después, en /opt/mani/.env.<ambiente>:
--   Core:     DATABASE_URL=postgres://mani_core_svc:<clave>@<host>:5432/postgres?sslmode=require
--   Dispatch: ConnectionStrings__DefaultConnection=Host=<host>;Database=postgres;Username=mani_dispatch_svc;Password=<clave>;SSL Mode=Require
-- (con el pooler de Supabase el usuario lleva el sufijo del proyecto:
--  mani_core_svc.<project_ref>).
--
-- Solo da LOGIN y contraseña. No menciona atributos: desde PostgreSQL 16 cada uno
-- exige tenerlo o ser superusuario, y `postgres` en Supabase no lo es. En su lugar
-- comprueba al final que ninguno salta RLS, y termina en error si alguno lo hace.
-- Es idempotente: reaplicarlo solo rota la contraseña.
-- =====================================================================

\if :{?core_password}
\else
  \echo 'Falta -v core_password=...'
  \quit 1
\endif
\if :{?dispatch_password}
\else
  \echo 'Falta -v dispatch_password=...'
  \quit 1
\endif

ALTER ROLE mani_core_svc LOGIN PASSWORD :'core_password';
ALTER ROLE mani_dispatch_svc LOGIN PASSWORD :'dispatch_password';

-- Lo que debe quedar: los dos con LOGIN y ninguno con BYPASSRLS ni SUPERUSER.
SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
  FROM pg_roles
 WHERE rolname IN ('mani_core_svc', 'mani_dispatch_svc')
 ORDER BY rolname;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_roles
         WHERE rolname IN ('mani_core_svc', 'mani_dispatch_svc')
           AND (rolsuper OR rolbypassrls OR NOT rolcanlogin)
    ) THEN
        RAISE EXCEPTION 'TEC-21: mani_core_svc y mani_dispatch_svc deben tener LOGIN y no tener SUPERUSER ni BYPASSRLS';
    END IF;
END $$;
