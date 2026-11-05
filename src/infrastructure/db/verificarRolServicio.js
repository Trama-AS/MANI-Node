/**
 * Comprueba con qué rol se conecta Core a PostgreSQL (SCRUM-1468 / TEC-21).
 *
 * El aislamiento entre tenants (RNF-01) solo lo garantiza RLS si el rol de la conexión no se lo salta. Un
 * DATABASE_URL con `postgres` (SUPERUSER, BYPASSRLS) deja todas las políticas sin evaluar y el aislamiento
 * descansa solo en el código, que es lo que QA midió. Esta verificación lo hace visible al arrancar.
 *
 * @param {{ query: Function }} pool Pool de `pg`.
 * @returns {Promise<{ rol: string, saltaRls: boolean }>}
 */
async function inspeccionarRol(pool) {
  const { rows } = await pool.query(
    'SELECT current_user AS rol, (rolsuper OR rolbypassrls) AS salta_rls FROM pg_roles WHERE rolname = current_user'
  );
  const fila = rows[0];
  return { rol: fila?.rol ?? 'desconocido', saltaRls: Boolean(fila?.salta_rls) };
}

/**
 * En QA y producción falla si el rol salta RLS; en desarrollo y pruebas solo avisa, porque la base local suele
 * levantarse con `postgres`.
 *
 * @param {{ getPool: Function, isConfigured: Function }} pgPoolFactory
 * @param {{ exigir: boolean, logger?: Console }} opciones
 */
async function verificarRolServicio(pgPoolFactory, { exigir, logger = console }) {
  if (!pgPoolFactory.isConfigured()) return null;
  const { rol, saltaRls } = await inspeccionarRol(pgPoolFactory.getPool());
  if (!saltaRls) {
    logger.log(`🔒 PostgreSQL: Core conecta como ${rol}, sin BYPASSRLS (RLS activo)`);
    return { rol, saltaRls };
  }
  const mensaje =
    `DATABASE_URL conecta como "${rol}", que tiene SUPERUSER o BYPASSRLS: las políticas RLS no se evaluarían. ` +
    'Core debe conectarse como mani_core_svc (SCRUM-1468, db/ops/credenciales_roles_servicio.sql).';
  if (exigir) throw new Error(mensaje);
  logger.warn(`⚠️  ${mensaje}`);
  return { rol, saltaRls };
}

module.exports = { verificarRolServicio, inspeccionarRol };
