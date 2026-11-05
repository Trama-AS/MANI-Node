const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');
const { ConflictError } = require('../../domain/errors/DomainError');
const { enContextoTenant, tenantDeLaIdentidad, fallaDeBase } = require('../db/enContextoTenant');

const UNIQUE_VIOLATION_CODE = '23505';
const COLUMNAS = 'c.id, c.nombre, c.estado, c.flujo_operativo, c.tenant_id';
// La vista de administración agrega la fecha de alta y cuántos aliados declararon la categoría (SCRUM-1390).
const COLUMNAS_ADMIN = `${COLUMNAS}, c.created_at,
  (SELECT count(*)::int FROM aliado_categoria ac WHERE ac.categoria_id = c.id AND ac.tenant_id = c.tenant_id) AS aliados`;

function toDomain(row, { conConteo = false } = {}) {
  if (!row) return null;
  return new Category({
    id: row.id,
    name: row.nombre,
    active: row.estado === 'ACTIVO',
    tenantId: row.tenant_id,
    flujoOperativo: row.flujo_operativo,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at ?? null,
    alliesCount: conConteo ? Number(row.aliados ?? 0) : null,
  });
}

function traducir(err, mensaje) {
  if (err && err.code === UNIQUE_VIOLATION_CODE) {
    return new ConflictError('Ya existe una categoría con ese nombre en este tenant', 'CATEGORY_NAME_ALREADY_EXISTS');
  }
  return fallaDeBase(mensaje, err);
}

/**
 * Catálogo de categorías por `pg` como `mani_core_svc` (SCRUM-1468). `categoria_servicio` es por tenant: cada lectura
 * y escritura corre con app.set_context y la política `categoria_servicio_tenant` (0007) aísla las filas.
 */
class PgCatalogRepository extends ICatalogRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgCatalogRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  /**
   * Antes devolvía las categorías de todos los tenants (service_role). Con RLS solo existe el catálogo del tenant de
   * la identidad vigente; fuera de una operación con identidad no hay ninguno.
   */
  async findAllCategories() {
    const tenantId = tenantDeLaIdentidad();
    if (!tenantId) return [];
    return this.#varias(tenantId, `SELECT ${COLUMNAS} FROM categoria_servicio c WHERE c.tenant_id = $1`, [tenantId], {
      mensaje: 'Error consultando categorías',
    });
  }

  async findActiveByTenant(tenantId) {
    return this.#varias(
      tenantId,
      `SELECT ${COLUMNAS} FROM categoria_servicio c
        WHERE c.tenant_id = $1 AND c.estado = 'ACTIVO'
        ORDER BY c.nombre ASC`,
      [tenantId],
      { mensaje: 'Error consultando categorías' }
    );
  }

  async findById(tenantId, categoryId) {
    const filas = await this.#varias(
      tenantId,
      `SELECT ${COLUMNAS_ADMIN} FROM categoria_servicio c WHERE c.tenant_id = $1 AND c.id::text = $2`,
      [tenantId, String(categoryId)],
      { mensaje: 'Error consultando categoría', conConteo: true }
    );
    return filas[0] ?? null;
  }

  async findAllByTenant(tenantId, { onlyActive = false } = {}) {
    return this.#varias(
      tenantId,
      `SELECT ${COLUMNAS_ADMIN} FROM categoria_servicio c
        WHERE c.tenant_id = $1 AND ($2::boolean IS FALSE OR c.estado = 'ACTIVO')`,
      [tenantId, onlyActive],
      { mensaje: 'Error consultando categorías del tenant', conConteo: true }
    );
  }

  async create(tenantId, { name, flujoOperativo }) {
    const filas = await this.#varias(
      tenantId,
      `WITH c AS (
         INSERT INTO categoria_servicio (tenant_id, nombre, estado, flujo_operativo)
         VALUES ($1, $2, 'ACTIVO', $3)
         RETURNING *
       )
       SELECT ${COLUMNAS}, c.created_at, 0 AS aliados FROM c`,
      [tenantId, name, flujoOperativo],
      { mensaje: 'Error creando categoría', conConteo: true }
    );
    return filas[0];
  }

  async update(tenantId, categoryId, { name, flujoOperativo }) {
    return this.#actualizar(
      tenantId,
      categoryId,
      `nombre = COALESCE($3, nombre), flujo_operativo = COALESCE($4, flujo_operativo)`,
      [name ?? null, flujoOperativo ?? null],
      'Error actualizando categoría'
    );
  }

  async setActive(tenantId, categoryId, active) {
    return this.#actualizar(
      tenantId,
      categoryId,
      'estado = $3',
      [active ? 'ACTIVO' : 'INACTIVO'],
      'Error actualizando el estado de la categoría'
    );
  }

  async #actualizar(tenantId, categoryId, asignaciones, valores, mensaje) {
    const filas = await this.#varias(
      tenantId,
      `WITH c AS (
         UPDATE categoria_servicio SET ${asignaciones}
          WHERE tenant_id = $1 AND id::text = $2
         RETURNING *
       )
       SELECT ${COLUMNAS_ADMIN} FROM c`,
      [tenantId, String(categoryId), ...valores],
      { mensaje, conConteo: true }
    );
    return filas[0] ?? null;
  }

  async #varias(tenantId, sql, params, { mensaje, conConteo = false }) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) => client.query(sql, params));
      return rows.map((fila) => toDomain(fila, { conConteo }));
    } catch (err) {
      throw traducir(err, mensaje);
    }
  }
}

module.exports = PgCatalogRepository;
