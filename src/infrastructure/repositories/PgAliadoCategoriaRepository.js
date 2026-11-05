const IAliadoCategoriaRepository = require('../../domain/ports/IAliadoCategoriaRepository');
const { DomainError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { enContextoTenant, filaPlana, fallaDeBase } = require('../db/enContextoTenant');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORBIDDEN = () =>
  new DomainError('MANI-CAT-403: solo un aliado activo puede declarar categorías', 'MANI-CAT-403', 403);
const UNAVAILABLE = () => new DomainError('MANI-CAT-422C: categoría no disponible', 'MANI-CAT-422C', 422);

/**
 * Categorías declaradas por el aliado, todo por `pg` como `mani_core_svc` (SCRUM-1468). Antes el alta, la lectura y
 * el borrado iban por supabase-js con service_role (sin RLS) y solo el reemplazo atómico iba por `pg`
 * (TransactionalAliadoCategoriaRepository); ahora todas las operaciones corren con app.set_context del tenant.
 */
class PgAliadoCategoriaRepository extends IAliadoCategoriaRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgAliadoCategoriaRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async create({ tenantId, aliadoId, categoriaId }) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query(
          `INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id) VALUES ($1, $2, $3) RETURNING *`,
          [tenantId, aliadoId, categoriaId]
        )
      );
      return filaPlana(rows[0]);
    } catch (err) {
      throw fallaDeBase('Error asociando categoría al aliado', err);
    }
  }

  async findByAliadoId(tenantId, aliadoId) {
    if (!tenantId) return [];
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('SELECT categoria_id FROM aliado_categoria WHERE tenant_id = $1 AND aliado_id = $2', [
          tenantId,
          aliadoId,
        ])
      );
      return rows.map((fila) => fila.categoria_id);
    } catch (err) {
      throw fallaDeBase('Error consultando categorías del aliado', err);
    }
  }

  async deleteByAliadoId(tenantId, aliadoId) {
    try {
      await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('DELETE FROM aliado_categoria WHERE tenant_id = $1 AND aliado_id = $2', [tenantId, aliadoId])
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando categorías del aliado', err);
    }
  }

  /**
   * Reemplazo atómico del conjunto de categorías del aliado (ADR-0022, SCRUM-1071), porte de `guardar_mis_categorias`:
   *  1. bloquea la fila del aliado (FOR UPDATE), así dos PUT del mismo aliado se serializan;
   *  2. exige usuario ACTIVO con rol ALIADO del mismo tenant;
   *  3. exige que todas las categorías existan, estén ACTIVO y sean del tenant;
   *  4. borra las que salen, inserta las nuevas y devuelve el conjunto final.
   * Corre con el tenant, usuario y rol del JWT (SCRUM-1380). Si un paso falla se hace ROLLBACK: el aliado nunca queda
   * sin categorías por un insert fallido (observación de QA en MANI-Node#18).
   */
  async setAliadoCategorias(tenantId, aliadoId, categoriaIds, ctx = {}) {
    const ids = [...new Set(categoriaIds || [])];
    if (ids.length === 0) {
      throw new DomainError('MANI-CAT-422V: selecciona al menos una categoría', 'MANI-CAT-422V', 422);
    }
    if (!UUID_RE.test(String(tenantId)) || !UUID_RE.test(String(aliadoId))) {
      throw FORBIDDEN();
    }
    if (ids.some((id) => !UUID_RE.test(String(id)))) {
      throw UNAVAILABLE();
    }

    try {
      return await runInTenantContext(
        this.pgPoolFactory,
        { tenantId, userId: ctx.userId, role: ctx.role || 'ALLY' },
        async (client) => {
          const owner = await client.query(
            `SELECT a.id
               FROM aliado a
               JOIN usuario u ON u.id = a.usuario_id AND u.tenant_id = a.tenant_id
              WHERE a.id = $1 AND a.tenant_id = $2 AND u.estado = 'ACTIVO' AND u.rol = 'ALIADO'
                FOR UPDATE OF a`,
            [aliadoId, tenantId]
          );
          if (owner.rowCount === 0) throw FORBIDDEN();

          const valid = await client.query(
            `SELECT count(*)::int AS total
               FROM categoria_servicio
              WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND estado = 'ACTIVO'`,
            [ids, tenantId]
          );
          if (valid.rows[0].total !== ids.length) throw UNAVAILABLE();

          await client.query(
            `DELETE FROM aliado_categoria
              WHERE aliado_id = $1 AND tenant_id = $2 AND categoria_id <> ALL($3::uuid[])`,
            [aliadoId, tenantId, ids]
          );
          await client.query(
            `INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id)
             SELECT $2, $1, x FROM unnest($3::uuid[]) AS x
             ON CONFLICT (aliado_id, categoria_id) DO NOTHING`,
            [aliadoId, tenantId, ids]
          );

          const result = await client.query(
            `SELECT categoria_id FROM aliado_categoria
              WHERE aliado_id = $1 AND tenant_id = $2
              ORDER BY categoria_id`,
            [aliadoId, tenantId]
          );
          return result.rows.map((row) => row.categoria_id);
        }
      );
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** Errores de dominio pasan intactos; los de PostgreSQL se traducen sin filtrar detalles internos. */
  mapError(err) {
    if (err instanceof DomainError) return err;
    if ((err && err.code === 'P0001' && /MANI-CAT-422C/.test(err.message)) || (err && err.code === '23503')) {
      return UNAVAILABLE();
    }
    return fallaDeBase('Error guardando las categorías del aliado', err);
  }
}

module.exports = PgAliadoCategoriaRepository;
