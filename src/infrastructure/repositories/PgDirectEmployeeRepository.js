const IDirectEmployeeRepository = require('../../domain/ports/IDirectEmployeeRepository');
const { DomainError, ConflictError, ValidationError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_DOCUMENTO = 'aliado_numero_documento_identidad_tenant_unique';

/**
 * Registro atómico del empleado directo sobre `pg` (SCRUM-1376, RF-05). Usuario, aliado VERIFICADO, categorías y copia
 * del documento se escriben en UNA transacción con el contexto del administrador (tenant y rol del JWT, ADR-0032),
 * como `mani_core_svc` sin BYPASSRLS: el tenant de todas las filas sale de `app.tenant_id()` y la política de la
 * migración 0026 limita el alta del documento a aliados EMPLEADO_DIRECTO del mismo tenant. Un fallo revierte todo, de
 * modo que un reintento legítimo no choca con filas a medias.
 */
class PgDirectEmployeeRepository extends IDirectEmployeeRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgDirectEmployeeRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async registrar(ctx, datos) {
    const { tenantId, userId } = ctx;
    const ids = [...new Set(datos.categoriaIds)];
    if (ids.some((id) => !UUID_RE.test(String(id)))) {
      throw new ValidationError('Alguna categoría no existe o no está activa', 'CATEGORY_NOT_FOUND');
    }
    try {
      return await runInTenantContext(this.pgPoolFactory, { tenantId, userId, role: 'ADMIN' }, async (client) => {
        const categorias = await client.query(
          `SELECT count(*)::int AS total FROM categoria_servicio
            WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND estado = 'ACTIVO'`,
          [ids, tenantId]
        );
        if (categorias.rows[0].total !== ids.length) {
          throw new ValidationError('Alguna categoría no existe o no está activa', 'CATEGORY_NOT_FOUND');
        }

        await client.query(
          `INSERT INTO usuario (id, tenant_id, email, rol, estado, telefono)
           VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO', $4)`,
          [datos.usuarioId, tenantId, datos.email, datos.phone]
        );
        const aliado = await client.query(
          `INSERT INTO aliado (tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion,
                               tipo_documento_identidad, numero_documento_identidad, verificado_por, fecha_verificacion)
           VALUES ($1, $2, 'EMPLEADO_DIRECTO', $3, 'VERIFICADO', $4, $5, $6, now())
           RETURNING id`,
          [
            tenantId,
            datos.usuarioId,
            datos.fullName,
            datos.documentType,
            datos.documentNumber,
            UUID_RE.test(String(userId)) ? userId : null,
          ]
        );
        const aliadoId = aliado.rows[0].id;
        await client.query(
          `INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id)
           SELECT $1, $2, x FROM unnest($3::uuid[]) AS x`,
          [tenantId, aliadoId, ids]
        );
        const documento = await client.query(
          `INSERT INTO documento_kyc (tenant_id, aliado_id, tipo_documento, ruta_storage, estado)
           VALUES ($1, $2, $3, $4, 'VERIFICADO') RETURNING id`,
          [tenantId, aliadoId, datos.documento.tipoDocumento, datos.documento.rutaStorage]
        );
        return { aliadoId, documentoId: documento.rows[0].id };
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** Errores de dominio pasan intactos; los de PostgreSQL se traducen sin filtrar detalles internos. */
  mapError(err) {
    if (err instanceof DomainError) return err;
    if (err && err.code === '23505') {
      if (err.constraint === UNIQUE_DOCUMENTO) {
        return new ConflictError('Ya existe un aliado registrado con ese número de documento', 'DOCUMENT_ALREADY_REGISTERED');
      }
      return new ConflictError('Ya existe un usuario registrado con ese email en este tenant', 'EMAIL_ALREADY_REGISTERED');
    }
    const mapped = new DomainError('Error registrando al empleado directo', 'INTERNAL_ERROR', 500);
    mapped.cause = err;
    return mapped;
  }
}

module.exports = PgDirectEmployeeRepository;
