const ILegalDocumentRepository = require('../../domain/ports/ILegalDocumentRepository');
const LegalDocument = require('../../domain/entities/LegalDocument');
const { enContextoTenant, tenantDeLaIdentidad, consultaGlobal, fallaDeBase } = require('../db/enContextoTenant');

const COLUMNAS = 'id, tenant_id, tipo, version, contenido, is_active, created_at';

function toDomain(row) {
  return new LegalDocument({
    id: row.id,
    tenantId: row.tenant_id,
    tipo: row.tipo,
    version: row.version,
    contenido: row.contenido,
    isActive: row.is_active,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
}

/**
 * Documentos legales (habeas data, SCRUM-856) por `pg` como `mani_core_svc` (SCRUM-1468). Los globales
 * (`tenant_id IS NULL`) se leen sin contexto; los de un tenant, con su app.set_context. La política
 * `documento_legal_lectura` (0007) solo deja ver los activos del tenant fijado o los globales.
 */
class PgLegalDocumentRepository extends ILegalDocumentRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgLegalDocumentRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async getActiveDocuments(tenantId) {
    try {
      const sql = `SELECT ${COLUMNAS} FROM documento_legal
                    WHERE is_active = true AND (tenant_id IS NULL OR tenant_id = $1)`;
      const { rows } = tenantId
        ? await enContextoTenant(this.pgPoolFactory, tenantId, (client) => client.query(sql, [tenantId]))
        : await consultaGlobal(this.pgPoolFactory, sql, [null]);
      return rows.map(toDomain);
    } catch (err) {
      throw fallaDeBase('Error consultando documentos legales', err);
    }
  }

  /** El puerto no recibe el tenant: se usa el de la identidad vigente (el registro o la petición autenticada). */
  async findById(id) {
    const tenantId = tenantDeLaIdentidad();
    try {
      const sql = `SELECT ${COLUMNAS} FROM documento_legal WHERE id::text = $1`;
      const { rows } = tenantId
        ? await enContextoTenant(this.pgPoolFactory, tenantId, (client) => client.query(sql, [String(id)]))
        : await consultaGlobal(this.pgPoolFactory, sql, [String(id)]);
      return rows[0] ? toDomain(rows[0]) : null;
    } catch (err) {
      throw fallaDeBase('Error consultando documento legal', err);
    }
  }
}

module.exports = PgLegalDocumentRepository;
