const { DomainError } = require('../../domain/errors/DomainError');
const { identidadActual } = require('../../application/context/contextoIdentidad');
const { runInTenantContext } = require('./runInTenantContext');

/**
 * Ejecuta `trabajo(client)` en una transacción con `app.set_context` para `tenantId` (SCRUM-1468).
 *
 * El tenant es el que pide el repositorio; el usuario y el rol salen de la identidad verificada de la operación
 * (contextoIdentidad) solo si pertenece a ese mismo tenant. Si no hay identidad, o es de otro tenant, se fija el
 * tenant sin usuario ni rol: las políticas que exigen un usuario concreto (KYC, consentimientos) no dejan pasar
 * nada, que es fallar cerrado.
 */
function enContextoTenant(pgPoolFactory, tenantId, trabajo) {
  const identidad = identidadActual();
  const propia = identidad && identidad.tenantId === tenantId;
  return runInTenantContext(
    pgPoolFactory,
    { tenantId, userId: propia ? identidad.userId : null, role: propia ? identidad.role : null, correlationId: identidad?.correlationId ?? null },
    trabajo
  );
}

/**
 * Tenant de la identidad vigente, para los pocos métodos de puerto que no lo reciben (p. ej. `hasConsented`).
 * `null` fuera de una operación con identidad.
 */
function tenantDeLaIdentidad() {
  return identidadActual()?.tenantId ?? null;
}

/**
 * Consulta sobre un catálogo global sin `tenant_id` (`tenant`, `zona`, `geometria_territorial`, documentos legales
 * globales). No abre contexto: sus políticas de lectura no dependen del tenant. Sin DATABASE_URL falla con 503.
 */
async function consultaGlobal(pgPoolFactory, sql, params = []) {
  const pool = pgPoolFactory.getPool();
  if (!pool) {
    throw new DomainError('MANI-SRV-503: la base de datos no está configurada (DATABASE_URL)', 'SERVICE_UNAVAILABLE', 503);
  }
  return pool.query(sql, params);
}

/** `pg` entrega las fechas como Date; los casos de uso esperan texto ISO, como lo devolvía supabase-js. */
function filaPlana(fila) {
  if (!fila) return null;
  const salida = { ...fila };
  for (const [clave, valor] of Object.entries(salida)) {
    if (valor instanceof Date) salida[clave] = valor.toISOString();
  }
  return salida;
}

/**
 * Traduce un error de PostgreSQL a un 500 de dominio sin filtrar el detalle interno al cliente; el original queda en
 * `cause` para el log. Un DomainError pasa intacto.
 */
function fallaDeBase(mensaje, err) {
  if (err instanceof DomainError) return err;
  const traducido = new DomainError(mensaje, 'INTERNAL_ERROR', 500);
  traducido.cause = err;
  return traducido;
}

module.exports = { enContextoTenant, tenantDeLaIdentidad, consultaGlobal, filaPlana, fallaDeBase };
