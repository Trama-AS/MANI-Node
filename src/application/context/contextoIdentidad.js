const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Identidad verificada de quien origina la operación en curso (SCRUM-1468, ADR-0032).
 *
 * Core se conecta a PostgreSQL como `mani_core_svc`, sin BYPASSRLS: las políticas comparan cada fila con el
 * tenant, el usuario y el rol que fija `app.set_context` al abrir la transacción. Los puertos de los repositorios
 * reciben el tenant de forma explícita, pero no el usuario ni el rol; esta identidad ambiente los completa sin
 * cambiar la firma de cada caso de uso.
 *
 * Solo dos sitios la fijan, y los dos con una identidad ya verificada:
 *   - el middleware `authenticate`, con los claims del JWT;
 *   - los registros públicos, con el usuario recién creado en Auth, que es quien actúa en esa transacción.
 *
 * Vive en una AsyncLocalStorage: cada petición tiene la suya y no se filtra a otra que comparta el proceso.
 */
const almacen = new AsyncLocalStorage();

/**
 * Ejecuta `trabajo` con `identidad` como identidad vigente y devuelve lo que devuelva `trabajo`.
 * @param {{ tenantId: string, userId?: string|null, role?: string|null, correlationId?: string|null }} identidad
 * @param {() => any} trabajo
 */
function ejecutarComo(identidad, trabajo) {
  if (!identidad || !identidad.tenantId) {
    throw new Error('ejecutarComo exige una identidad con tenantId');
  }
  const congelada = Object.freeze({
    tenantId: identidad.tenantId,
    userId: identidad.userId ?? null,
    role: identidad.role ?? null,
    // SCRUM-1657: el correlation ID de la petición viaja con la identidad hasta la transacción, donde queda en
    // `app.correlation_id` y lo toman los DEFAULT de las tablas de trazabilidad.
    correlationId: identidad.correlationId ?? null,
  });
  return almacen.run(congelada, trabajo);
}

/** Identidad vigente o `null` fuera de una petición autenticada o de un registro. */
function identidadActual() {
  return almacen.getStore() ?? null;
}

module.exports = { ejecutarComo, identidadActual };
