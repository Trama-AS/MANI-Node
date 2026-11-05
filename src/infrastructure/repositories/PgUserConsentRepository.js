const IUserConsentRepository = require('../../domain/ports/IUserConsentRepository');
const UserConsent = require('../../domain/entities/UserConsent');
const { DomainError } = require('../../domain/errors/DomainError');
const { enContextoTenant, tenantDeLaIdentidad, fallaDeBase } = require('../db/enContextoTenant');

const COLUMNAS = 'id, tenant_id, usuario_id, documento_legal_id, ip_address, user_agent, created_at';

function toDomain(row) {
  return new UserConsent({
    id: row.id,
    tenantId: row.tenant_id,
    usuarioId: row.usuario_id,
    documentoLegalId: row.documento_legal_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  });
}

/**
 * Consentimientos de habeas data (SCRUM-856) por `pg` como `mani_core_svc` (SCRUM-1468).
 *
 * Las políticas de `consentimiento_usuario` (0007 y 0037) limitan cada fila a su propio usuario: el registro corre
 * con la identidad del usuario recién creado (contextoIdentidad) y por eso puede dejar su consentimiento.
 *
 * El consentimiento es evidencia: si ya existe para el mismo usuario y documento, se conserva el primero (fecha, IP y
 * agente originales) en lugar de sobrescribirlo, como hacía el upsert anterior.
 */
class PgUserConsentRepository extends IUserConsentRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgUserConsentRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async create(consent) {
    const tenantId = consent.tenantId || tenantDeLaIdentidad();
    if (!tenantId) {
      throw new DomainError('MANI-RLS-400: el consentimiento exige el tenant del usuario', 'MANI-RLS-400', 400);
    }
    try {
      const fila = await enContextoTenant(this.pgPoolFactory, tenantId, async (client) => {
        const insertado = await client.query(
          `INSERT INTO consentimiento_usuario (tenant_id, usuario_id, documento_legal_id, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (usuario_id, documento_legal_id) DO NOTHING
           RETURNING ${COLUMNAS}`,
          [consent.tenantId ?? null, consent.usuarioId, consent.documentoLegalId, consent.ipAddress, consent.userAgent]
        );
        if (insertado.rows[0]) return insertado.rows[0];
        const existente = await client.query(
          `SELECT ${COLUMNAS} FROM consentimiento_usuario WHERE usuario_id = $1 AND documento_legal_id = $2`,
          [consent.usuarioId, consent.documentoLegalId]
        );
        return existente.rows[0];
      });
      if (!fila) {
        // Ni se insertó ni se ve el existente: la política no reconoce al usuario de la identidad vigente.
        throw new DomainError('MANI-RLS-403: el consentimiento solo lo registra el propio usuario', 'MANI-RLS-403', 403);
      }
      return toDomain(fila);
    } catch (err) {
      throw fallaDeBase('Error registrando consentimiento de usuario', err);
    }
  }

  /** El puerto no recibe el tenant: se usa el de la identidad vigente. Sin identidad no hay consentimiento visible. */
  async hasConsented(usuarioId, documentoLegalId) {
    const tenantId = tenantDeLaIdentidad();
    if (!tenantId) return false;
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('SELECT 1 FROM consentimiento_usuario WHERE usuario_id = $1 AND documento_legal_id = $2', [
          usuarioId,
          documentoLegalId,
        ])
      );
      return rows.length > 0;
    } catch (err) {
      throw fallaDeBase('Error verificando consentimiento', err);
    }
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const tenant = tenantId || tenantDeLaIdentidad();
    if (!tenant) return;
    try {
      await enContextoTenant(this.pgPoolFactory, tenant, (client) =>
        client.query(
          'DELETE FROM consentimiento_usuario WHERE usuario_id = $1 AND ($2::uuid IS NULL OR tenant_id = $2::uuid)',
          [usuarioId, tenantId ?? null]
        )
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando consentimientos de usuario', err);
    }
  }
}

module.exports = PgUserConsentRepository;
