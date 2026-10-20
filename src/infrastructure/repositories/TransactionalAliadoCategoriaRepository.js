const IAliadoCategoriaRepository = require('../../domain/ports/IAliadoCategoriaRepository');
const { DomainError } = require('../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FORBIDDEN = () =>
  new DomainError('MANI-CAT-403: solo un aliado activo puede declarar categorías', 'MANI-CAT-403', 403);
const UNAVAILABLE = () => new DomainError('MANI-CAT-422C: categoría no disponible', 'MANI-CAT-422C', 422);

/**
 * Reemplazo atómico del conjunto de categorías del aliado (ADR-0022, SCRUM-1071).
 * Porta `guardar_mis_categorias` (database/migrations/004_aliado_categorias.sql,
 * hoy en MANI-APIGateway) a una transacción de aplicación sobre `pg`:
 *
 *  1. bloquea la fila del aliado (FOR UPDATE), así dos PUT del mismo aliado se serializan;
 *  2. exige usuario ACTIVO con rol ALIADO del mismo tenant;
 *  3. exige que todas las categorías existan, estén ACTIVO y sean del tenant;
 *  4. borra las que salen, inserta las nuevas y devuelve el conjunto final.
 *
 * Si cualquier paso falla se hace ROLLBACK: el aliado nunca queda sin categorías
 * por un insert fallido (observación de QA en MANI-Node#18). El resto de
 * operaciones (create, findByAliadoId, deleteByAliadoId) se delegan sin cambios
 * al repositorio base, para no alterar el flujo de registro.
 */
class TransactionalAliadoCategoriaRepository extends IAliadoCategoriaRepository {
  constructor({ pgPoolFactory, delegate }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para TransactionalAliadoCategoriaRepository');
    if (!delegate) throw new Error('delegate es requerido para TransactionalAliadoCategoriaRepository');
    this.pgPoolFactory = pgPoolFactory;
    this.delegate = delegate;
  }

  create(aliadoCategoria) {
    return this.delegate.create(aliadoCategoria);
  }

  findByAliadoId(tenantId, aliadoId) {
    return this.delegate.findByAliadoId(tenantId, aliadoId);
  }

  deleteByAliadoId(tenantId, aliadoId) {
    return this.delegate.deleteByAliadoId(tenantId, aliadoId);
  }

  async setAliadoCategorias(tenantId, aliadoId, categoriaIds) {
    const ids = [...new Set(categoriaIds || [])];
    if (ids.length === 0) {
      throw new DomainError('MANI-CAT-422V: selecciona al menos una categoría', 'MANI-CAT-422V', 422);
    }
    // Un valor que no es UUID no puede existir: se responde igual que una categoría inexistente.
    if (!UUID_RE.test(String(tenantId)) || !UUID_RE.test(String(aliadoId))) {
      throw FORBIDDEN();
    }
    if (ids.some((id) => !UUID_RE.test(String(id)))) {
      throw UNAVAILABLE();
    }

    const pool = this.pgPoolFactory.getPool();
    if (!pool) {
      throw new DomainError('DATABASE_URL no está configurada', 'INTERNAL_ERROR', 500);
    }

    const client = await pool.connect();
    let releaseError;
    try {
      await client.query('BEGIN');

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

      await client.query('COMMIT');
      return result.rows.map((row) => row.categoria_id);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Conexión en estado desconocido: se descarta del pool en lugar de reutilizarla.
        releaseError = rollbackErr;
      }
      throw this.mapError(err);
    } finally {
      client.release(releaseError);
    }
  }

  /** Errores de dominio pasan intactos; los de PostgreSQL se traducen sin filtrar detalles internos. */
  mapError(err) {
    if (err instanceof DomainError) return err;
    // Trigger trg_aliado_categoria_tenant (RAISE EXCEPTION 'MANI-CAT-422C...') o FK de categoría inexistente.
    if ((err && err.code === 'P0001' && /MANI-CAT-422C/.test(err.message)) || (err && err.code === '23503')) {
      return UNAVAILABLE();
    }
    const mapped = new DomainError('Error guardando las categorías del aliado', 'INTERNAL_ERROR', 500);
    mapped.cause = err;
    return mapped;
  }
}

module.exports = TransactionalAliadoCategoriaRepository;
