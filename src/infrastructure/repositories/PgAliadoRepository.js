const IAliadoRepository = require('../../domain/ports/IAliadoRepository');
const { DomainError } = require('../../domain/errors/DomainError');
const { ESTADO_VERIFICACION_TO_DB } = require('./supabaseEnumMaps');
const { enContextoTenant, filaPlana, fallaDeBase } = require('../db/enContextoTenant');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS_DETALLE =
  'id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion, motivo_rechazo, fecha_verificacion, created_at';

/**
 * Aliados por `pg` como `mani_core_svc` (SCRUM-1468). Reúne lo que antes repartían SupabaseAliadoRepository
 * (service_role, sin RLS) y TransactionalAliadoRepository, cuya resolución de la verificación hacía el UPDATE sin
 * app.set_context: con un rol sin BYPASSRLS ese UPDATE no veía la fila y toda aprobación respondía 409.
 * Cada operación corre en la transacción del tenant; la política `aliado_tenant` (0007) aísla las filas.
 */
class PgAliadoRepository extends IAliadoRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgAliadoRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findByDocumentNumber(tenantId, documentNumber) {
    return this.#unaFila(
      tenantId,
      `SELECT id, usuario_id, numero_documento_identidad
         FROM aliado
        WHERE tenant_id = $1 AND numero_documento_identidad = $2
        LIMIT 1`,
      [tenantId, documentNumber],
      'Error consultando aliado'
    );
  }

  async findByUsuarioId(tenantId, usuarioId) {
    // Sin tenant no hay contexto que fijar: con RLS no se vería ninguna fila, así que se responde sin consultar.
    if (!tenantId) return null;
    return this.#unaFila(
      tenantId,
      `SELECT id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion
         FROM aliado
        WHERE tenant_id = $1 AND usuario_id = $2`,
      [tenantId, usuarioId],
      'Error consultando aliado'
    );
  }

  async create({
    tenantId,
    usuarioId,
    tipo,
    nombreRazonSocial,
    estadoVerificacion,
    documentType,
    documentNumber,
    nombreRepresentante,
    docRepresentante,
  }) {
    // Upsert por usuario_id, como el de supabase-js: un reintento del registro no duplica al aliado. Los datos del
    // representante legal solo se escriben si llegan (persona jurídica, 0008).
    return this.#unaFila(
      tenantId,
      `INSERT INTO aliado (tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion,
                           tipo_documento_identidad, numero_documento_identidad,
                           nombre_representante_legal, documento_representante_legal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (usuario_id) DO UPDATE
          SET tenant_id = EXCLUDED.tenant_id,
              tipo = EXCLUDED.tipo,
              nombre_razon_social = EXCLUDED.nombre_razon_social,
              estado_verificacion = EXCLUDED.estado_verificacion,
              tipo_documento_identidad = EXCLUDED.tipo_documento_identidad,
              numero_documento_identidad = EXCLUDED.numero_documento_identidad,
              nombre_representante_legal = COALESCE(EXCLUDED.nombre_representante_legal, aliado.nombre_representante_legal),
              documento_representante_legal = COALESCE(EXCLUDED.documento_representante_legal, aliado.documento_representante_legal)
       RETURNING *`,
      [
        tenantId,
        usuarioId,
        tipo,
        nombreRazonSocial,
        ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion,
        documentType ?? null,
        documentNumber ?? null,
        nombreRepresentante || null,
        docRepresentante || null,
      ],
      'Error creando aliado'
    );
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    try {
      await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('DELETE FROM aliado WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId])
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando aliado', err);
    }
  }

  async findById(tenantId, aliadoId) {
    if (!UUID_RE.test(String(aliadoId))) return null;
    return this.#unaFila(
      tenantId,
      `SELECT ${COLUMNAS_DETALLE} FROM aliado WHERE tenant_id = $1 AND id = $2`,
      [tenantId, aliadoId],
      'Error consultando aliado'
    );
  }

  async findByTenant(tenantId, { estadoVerificacion } = {}) {
    const estado = estadoVerificacion ? ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion : null;
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query(
          `SELECT ${COLUMNAS_DETALLE}
             FROM aliado
            WHERE tenant_id = $1 AND ($2::text IS NULL OR estado_verificacion = $2::text)
            ORDER BY created_at ASC`,
          [tenantId, estado]
        )
      );
      return rows.map(filaPlana);
    } catch (err) {
      throw fallaDeBase('Error listando aliados', err);
    }
  }

  /**
   * CA-5 de US-02.1.3 (TEC-20): quién resolvió queda en `aliado.verificado_por`. UPDATE condicional (solo si sigue
   * PENDIENTE, ADR-0016): si otro administrador ya decidió afecta 0 filas y devuelve `null`, y el caso de uso
   * responde 409.
   */
  async updateVerificationStatus(
    tenantId,
    aliadoId,
    { estadoVerificacion, motivoRechazo = null, fechaVerificacion, verificadoPor = null }
  ) {
    if (!UUID_RE.test(String(tenantId)) || !UUID_RE.test(String(aliadoId))) return null;
    if (verificadoPor !== null && !UUID_RE.test(String(verificadoPor))) {
      throw new DomainError('verificado_por debe ser el id del usuario que resuelve', 'INTERNAL_ERROR', 500);
    }
    return this.#unaFila(
      tenantId,
      `UPDATE aliado
          SET estado_verificacion = $3,
              motivo_rechazo = $4,
              fecha_verificacion = $5,
              verificado_por = $6
        WHERE tenant_id = $1 AND id = $2 AND estado_verificacion = 'PENDIENTE'
        RETURNING *`,
      [
        tenantId,
        aliadoId,
        ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion,
        motivoRechazo,
        fechaVerificacion || new Date().toISOString(),
        verificadoPor,
      ],
      'Error actualizando verificación de aliado'
    );
  }

  async #unaFila(tenantId, sql, params, mensaje) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) => client.query(sql, params));
      return filaPlana(rows[0] ?? null);
    } catch (err) {
      throw fallaDeBase(mensaje, err);
    }
  }
}

module.exports = PgAliadoRepository;
