const ITenantRepository = require('../../domain/ports/ITenantRepository');
const Tenant = require('../../domain/entities/Tenant');
const { consultaGlobal, fallaDeBase } = require('../db/enContextoTenant');

// SUSPENDIDO lo agrega la migración 0033 (SCRUM-901).
const ESTADO_FROM_DB = { ACTIVO: 'ACTIVE', SUSPENDIDO: 'SUSPENDED', INACTIVO: 'INACTIVE' };
const COLUMNAS = 'id, nombre, slug, estado';

function toDomain(row) {
  if (!row) return null;
  return new Tenant({
    id: row.id,
    name: row.nombre,
    slug: row.slug || row.id,
    status: ESTADO_FROM_DB[row.estado] || row.estado,
  });
}

/**
 * Directorio de tenants por `pg` como `mani_core_svc` (SCRUM-1468). `tenant` es un catálogo sin `tenant_id`: su
 * política `tenant_lectura` (0007) deja leerlo sin contexto, y así lo resuelve el registro antes de que exista sesión.
 */
class PgTenantRepository extends ITenantRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgTenantRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findAll() {
    return this.#consultar(`SELECT ${COLUMNAS} FROM tenant ORDER BY nombre`, [], 'Error consultando tenants');
  }

  async findById(id) {
    const filas = await this.#consultar(`SELECT ${COLUMNAS} FROM tenant WHERE id::text = $1`, [String(id)], 'Error consultando tenant');
    return filas[0] ?? null;
  }

  async findBySlug(slug) {
    const filas = await this.#consultar(`SELECT ${COLUMNAS} FROM tenant WHERE slug = $1`, [slug], 'Error consultando tenant');
    return filas[0] ?? null;
  }

  async #consultar(sql, params, mensaje) {
    try {
      const { rows } = await consultaGlobal(this.pgPoolFactory, sql, params);
      return rows.map(toDomain);
    } catch (err) {
      throw fallaDeBase(mensaje, err);
    }
  }
}

module.exports = PgTenantRepository;
