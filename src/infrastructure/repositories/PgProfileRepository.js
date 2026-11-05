const IProfileRepository = require('../../domain/ports/IProfileRepository');
const Profile = require('../../domain/entities/Profile');
const { ROL_FROM_DB, ESTADO_VERIFICACION_FROM_DB } = require('./supabaseEnumMaps');
const { enContextoTenant, fallaDeBase } = require('../db/enContextoTenant');

/**
 * Perfil propio por `pg` como `mani_core_svc` (SCRUM-1468): `usuario` y, si es aliado, su `aliado`, en una sola
 * lectura dentro del contexto del tenant. Un userId o tenant que no coincide da `null` (404), nunca el perfil de
 * otro usuario (B4); con RLS, además, la base no devuelve filas de otro tenant aunque la consulta no lo filtrara.
 */
class PgProfileRepository extends IProfileRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgProfileRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findByUserId(userId, tenantId = null) {
    // Sin tenant no hay contexto que fijar y RLS no dejaría ver la fila: perfil inexistente.
    if (!tenantId) return null;
    try {
      return await enContextoTenant(this.pgPoolFactory, tenantId, (client) => leerPerfil(client, userId, tenantId));
    } catch (err) {
      throw fallaDeBase('Error consultando perfil', err);
    }
  }

  async updateOwnProfile(userId, tenantId, changes = {}) {
    if (!tenantId) return null;
    try {
      return await enContextoTenant(this.pgPoolFactory, tenantId, async (client) => {
        const actual = await leerPerfil(client, userId, tenantId);
        if (!actual) return null;

        // telefono, direccion y foto_url se guardan en `usuario` (SCRUM-1377); solo cambia lo que llega.
        const columnas = { telefono: changes.phone, direccion: changes.address, foto_url: changes.photoUrl };
        const cambios = Object.entries(columnas).filter(([, valor]) => valor !== undefined);
        if (cambios.length > 0) {
          const asignaciones = cambios.map(([columna], i) => `${columna} = $${i + 3}`).join(', ');
          await client.query(`UPDATE usuario SET ${asignaciones} WHERE id = $1 AND tenant_id = $2`, [
            userId,
            tenantId,
            ...cambios.map(([, valor]) => valor),
          ]);
        }

        // El nombre solo se guarda para el aliado (aliado.nombre_razon_social): `usuario` no tiene columna de nombre,
        // así que para otros roles no se afirma un cambio que no quedó en la base.
        const guardaNombre = changes.fullName !== undefined && actual.role === 'ALLY';
        if (guardaNombre) {
          await client.query('UPDATE aliado SET nombre_razon_social = $3 WHERE usuario_id = $1 AND tenant_id = $2', [
            userId,
            tenantId,
            changes.fullName,
          ]);
        }

        return new Profile({
          id: actual.id,
          userId: actual.userId,
          role: actual.role,
          fullName: guardaNombre ? changes.fullName : actual.fullName,
          status: actual.status,
          tenantId: actual.tenantId,
          phone: changes.phone !== undefined ? changes.phone : actual.phone,
          address: changes.address !== undefined ? changes.address : actual.address,
          photoUrl: changes.photoUrl !== undefined ? changes.photoUrl : actual.photoUrl,
        });
      });
    } catch (err) {
      throw fallaDeBase('Error actualizando perfil', err);
    }
  }
}

async function leerPerfil(client, userId, tenantId) {
  const { rows } = await client.query(
    `SELECT u.id, u.tenant_id, u.email, u.rol, u.telefono, u.direccion, u.foto_url,
            a.nombre_razon_social, a.estado_verificacion
       FROM usuario u
       LEFT JOIN aliado a ON a.usuario_id = u.id AND a.tenant_id = u.tenant_id
      WHERE u.id::text = $1 AND u.tenant_id = $2`,
    [String(userId), tenantId]
  );
  const fila = rows[0];
  if (!fila) return null;

  const role = ROL_FROM_DB[fila.rol] || fila.rol;
  const esAliado = role === 'ALLY' && fila.nombre_razon_social !== null;
  return new Profile({
    id: fila.id,
    userId: fila.id,
    role,
    fullName: esAliado ? fila.nombre_razon_social : fila.email,
    status: esAliado ? ESTADO_VERIFICACION_FROM_DB[fila.estado_verificacion] || 'PENDING' : 'VERIFIED',
    tenantId: fila.tenant_id,
    phone: fila.telefono ?? undefined,
    address: fila.direccion ?? undefined,
    photoUrl: fila.foto_url ?? undefined,
  });
}

module.exports = PgProfileRepository;
