// Quién es, dentro del tenant del JWT, el usuario de la sesión: su perfil de aliado o su cliente activo.
// Lo comparten los repositorios del ciclo del servicio (cotización, ejecución y eventos), que corren dentro de
// runInTenantContext (ADR-0032). Cada uno decide qué error devolver si la cuenta no tiene ese perfil.

/**
 * @param {object} client cliente `pg` de la transacción
 * @param {{ tenantId: string, userId: string }} ctx contexto verificado
 * @param {() => Error} sinPerfil error si la cuenta no tiene perfil de aliado en el tenant
 * @returns {Promise<string>} id del aliado
 */
async function aliadoDeSesion(client, ctx, sinPerfil) {
  const { rows } = await client.query('SELECT id FROM aliado WHERE usuario_id = $1 AND tenant_id = $2', [
    ctx.userId,
    ctx.tenantId,
  ]);
  if (rows.length === 0) throw sinPerfil();
  return rows[0].id;
}

/**
 * Mismo criterio que la creación de solicitudes: un cliente del tenant cuyo usuario está ACTIVO.
 * @param {object} client cliente `pg` de la transacción
 * @param {{ tenantId: string, userId: string }} ctx contexto verificado
 * @param {() => Error} sinPerfil error si la cuenta no es un cliente activo del tenant
 * @returns {Promise<string>} id del cliente
 */
async function clienteActivoDeSesion(client, ctx, sinPerfil) {
  const { rows } = await client.query(
    `SELECT c.id FROM cliente c JOIN usuario u ON u.id = c.usuario_id
     WHERE c.usuario_id = $1 AND c.tenant_id = $2 AND u.estado = 'ACTIVO'`,
    [ctx.userId, ctx.tenantId]
  );
  if (rows.length === 0) throw sinPerfil();
  return rows[0].id;
}

/**
 * La solicitud solo es visible para su cliente dueño o su aliado asignado. Para cualquier otro usuario, del mismo
 * tenant o de otro, responde como inexistente: así no se revela que hay una solicitud ajena con ese id.
 * @param {object} client cliente `pg` de la transacción
 * @param {{ tenantId: string, userId: string, role: string }} ctx contexto verificado
 * @param {string} solicitudId
 * @param {() => Error} noEncontrada error si la sesión no la puede ver
 * @returns {Promise<{ estado: string }>} estado vigente de la solicitud
 */
async function solicitudVisible(client, ctx, solicitudId, noEncontrada) {
  const { rows } = await client.query(
    `SELECT s.estado
     FROM solicitud s
     LEFT JOIN cliente c ON c.id = s.cliente_id AND c.tenant_id = s.tenant_id
     LEFT JOIN aliado a ON a.id = s.aliado_id AND a.tenant_id = s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2
       AND (($3 = 'CLIENT' AND c.usuario_id = $4) OR ($3 = 'ALLY' AND a.usuario_id = $4))`,
    [solicitudId, ctx.tenantId, ctx.role, ctx.userId]
  );
  if (rows.length === 0) throw noEncontrada();
  return { estado: rows[0].estado };
}

module.exports = { aliadoDeSesion, clienteActivoDeSesion, solicitudVisible };
