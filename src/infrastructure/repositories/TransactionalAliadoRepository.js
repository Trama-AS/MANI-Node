const IAliadoRepository = require('../../domain/ports/IAliadoRepository');
const { DomainError } = require('../../domain/errors/DomainError');
const { ESTADO_VERIFICACION_TO_DB } = require('./supabaseEnumMaps');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolución de la verificación del aliado sobre `pg` (TEC-20, SCRUM-1467).
 *
 * CA-5 de US-02.1.3 exige que quién resolvió quede en la base (`aliado.verificado_por`),
 * no solo en el log. Con supabase-js eso no se puede probar contra PostgreSQL real, así
 * que con DATABASE_URL la escritura pasa por aquí: un UPDATE condicional (solo si sigue
 * PENDIENTE en el tenant, ADR-0016) que devuelve la fila guardada. Si otro administrador
 * ya decidió, afecta 0 filas y devuelve `null`, igual que el adaptador de Supabase (409).
 *
 * El resto de operaciones se delegan sin cambios al repositorio base.
 */
class TransactionalAliadoRepository extends IAliadoRepository {
  constructor({ pgPoolFactory, delegate }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para TransactionalAliadoRepository');
    if (!delegate) throw new Error('delegate es requerido para TransactionalAliadoRepository');
    this.pgPoolFactory = pgPoolFactory;
    this.delegate = delegate;
  }

  findByDocumentNumber(tenantId, documentNumber) {
    return this.delegate.findByDocumentNumber(tenantId, documentNumber);
  }

  findByUsuarioId(tenantId, usuarioId) {
    return this.delegate.findByUsuarioId(tenantId, usuarioId);
  }

  create(aliado) {
    return this.delegate.create(aliado);
  }

  deleteByUsuarioId(tenantId, usuarioId) {
    return this.delegate.deleteByUsuarioId(tenantId, usuarioId);
  }

  findById(tenantId, aliadoId) {
    return this.delegate.findById(tenantId, aliadoId);
  }

  findByTenant(tenantId, filters) {
    return this.delegate.findByTenant(tenantId, filters);
  }

  async updateVerificationStatus(
    tenantId,
    aliadoId,
    { estadoVerificacion, motivoRechazo = null, fechaVerificacion, verificadoPor = null }
  ) {
    // Un identificador que no es UUID no puede existir: se responde como "nada que actualizar".
    if (!UUID_RE.test(String(tenantId)) || !UUID_RE.test(String(aliadoId))) return null;
    if (verificadoPor !== null && !UUID_RE.test(String(verificadoPor))) {
      throw new DomainError('verificado_por debe ser el id del usuario que resuelve', 'INTERNAL_ERROR', 500);
    }

    const pool = this.pgPoolFactory.getPool();
    if (!pool) {
      throw new DomainError('DATABASE_URL no está configurada', 'INTERNAL_ERROR', 500);
    }

    const dbEstado = ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion;
    let result;
    try {
      result = await pool.query(
        `UPDATE aliado
            SET estado_verificacion = $3,
                motivo_rechazo = $4,
                fecha_verificacion = $5,
                verificado_por = $6
          WHERE tenant_id = $1 AND id = $2 AND estado_verificacion = 'PENDIENTE'
          RETURNING *`,
        [tenantId, aliadoId, dbEstado, motivoRechazo, fechaVerificacion || new Date().toISOString(), verificadoPor]
      );
    } catch (err) {
      const mapped = new DomainError('Error actualizando verificación de aliado', 'INTERNAL_ERROR', 500);
      mapped.cause = err;
      throw mapped;
    }

    if (result.rowCount === 0) return null;
    return toRow(result.rows[0]);
  }
}

/** `pg` entrega las fechas como Date; supabase-js, como texto ISO. Se iguala la forma. */
function toRow(row) {
  const out = { ...row };
  for (const [key, value] of Object.entries(out)) {
    if (value instanceof Date) out[key] = value.toISOString();
  }
  return out;
}

module.exports = TransactionalAliadoRepository;
