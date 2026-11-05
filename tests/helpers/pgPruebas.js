const PgPoolFactory = require('../../src/infrastructure/db/PgPoolFactory');

/**
 * Cadena de conexión que entra con `rol` como rol de la sesión (`-c role=...` al conectar). En CI y local la base de
 * pruebas se abre con `postgres`; así los repositorios corren como en QA, con `mani_core_svc` o `mani_dispatch_svc`,
 * sin BYPASSRLS, mientras la siembra sigue con el dueño del esquema (SCRUM-1468).
 */
function comoRol(url, rol) {
  return `${url}${url.includes('?') ? '&' : '?'}options=-c%20role%3D${rol}`;
}

/**
 * Dos fábricas sobre la misma base: `admin` (postgres) para sembrar y leer lo que quedó guardado, y `core`
 * (mani_core_svc) para el repositorio que se prueba. Las dos se cierran al terminar la prueba.
 */
function fabricasPg(t, url, { max = 5 } = {}) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_core_svc'), max });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { admin, core, pool: admin.getPool() };
}

module.exports = { comoRol, fabricasPg };
