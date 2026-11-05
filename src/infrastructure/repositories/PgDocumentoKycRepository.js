const IDocumentoKycRepository = require('../../domain/ports/IDocumentoKycRepository');
const { enContextoTenant, filaPlana, fallaDeBase } = require('../db/enContextoTenant');

const COLUMNAS = 'id, tenant_id, aliado_id, tipo_documento, ruta_storage, estado, fecha_carga';

/**
 * Documentos KYC del aliado por `pg` como `mani_core_svc` (SCRUM-1468).
 *
 * Es la tabla donde RLS exige más que el tenant (0007 §4.3 y 0027): leer o borrar exige ser el propio aliado o el
 * admin del tenant; dar de alta, el propio aliado (o el admin, solo para un empleado directo); resolver, el admin.
 * Por eso depende de la identidad vigente (contextoIdentidad): la petición autenticada en la bandeja de verificación
 * y el usuario recién creado en el registro. Sin identidad, la base no deja ver ni tocar ningún documento.
 */
class PgDocumentoKycRepository extends IDocumentoKycRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgDocumentoKycRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async createMany(tenantId, aliadoId, documentos) {
    if (!documentos || documentos.length === 0) return [];
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query(
          `INSERT INTO documento_kyc (tenant_id, aliado_id, tipo_documento, ruta_storage, estado)
           SELECT $1, $2, d.tipo, d.ruta, d.estado
             FROM unnest($3::text[], $4::text[], $5::text[]) AS d(tipo, ruta, estado)
           RETURNING ${COLUMNAS}`,
          [
            tenantId,
            aliadoId,
            documentos.map((d) => d.tipoDocumento),
            documentos.map((d) => d.rutaStorage),
            documentos.map((d) => d.estado || 'PENDIENTE'),
          ]
        )
      );
      return rows.map(filaPlana);
    } catch (err) {
      throw fallaDeBase('Error guardando documentos KYC', err);
    }
  }

  async deleteByAliadoId(tenantId, aliadoId) {
    try {
      await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('DELETE FROM documento_kyc WHERE tenant_id = $1 AND aliado_id = $2', [tenantId, aliadoId])
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando documentos KYC', err);
    }
  }

  async findByAliadoId(tenantId, aliadoId) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query(`SELECT ${COLUMNAS} FROM documento_kyc WHERE tenant_id = $1 AND aliado_id = $2`, [
          tenantId,
          aliadoId,
        ])
      );
      return rows.map(filaPlana);
    } catch (err) {
      throw fallaDeBase('Error consultando documentos KYC', err);
    }
  }

  async updateStatusByAliadoId(tenantId, aliadoId, estado) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query(
          `UPDATE documento_kyc SET estado = $3 WHERE tenant_id = $1 AND aliado_id = $2 RETURNING ${COLUMNAS}`,
          [tenantId, aliadoId, estado]
        )
      );
      return rows.map(filaPlana);
    } catch (err) {
      throw fallaDeBase('Error actualizando documentos KYC', err);
    }
  }
}

module.exports = PgDocumentoKycRepository;
