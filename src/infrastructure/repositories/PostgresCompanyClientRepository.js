const crypto = require('crypto');
const CompanyClient = require('../../domain/entities/CompanyClient');
const Site = require('../../domain/entities/Site');
const ICompanyClientRepository = require('../../domain/ports/ICompanyClientRepository');
const { DomainError, ValidationError } = require('../../domain/errors/DomainError');
const { enContextoTenant } = require('../db/enContextoTenant');

// Códigos de PostgreSQL de una zona inexistente (FK) o con formato inválido: son datos del cliente, no fallos del servicio.
const PG_ZONA_INVALIDA = new Set(['23503', '22P02']);

function traducirZonaInvalida(err) {
  if (PG_ZONA_INVALIDA.has(err.code)) {
    return new ValidationError('zonaId no corresponde a una zona del catálogo (RF-09)', 'VALIDATION_ERROR');
  }
  return err;
}

/**
 * Adaptador de Infraestructura: Repositorio PostgreSQL / Supabase para Cliente Empresa y Sitios (RF-08 / RF-09).
 * Implementa ICompanyClientRepository con transacciones reales y aislamiento multitenant estricto.
 */
class PostgresCompanyClientRepository extends ICompanyClientRepository {
  /**
   * @param {object} params
   * @param {import('../db/PgPoolFactory')} [params.pgPoolFactory]
   * @param {import('pg').Pool} [params.pgPool]
   */
  constructor({ pgPoolFactory, pgPool } = {}) {
    super();
    this.pgPoolFactory = pgPoolFactory;
    this.pgPool = pgPool;
  }

  /**
   * Ejecuta `trabajo(client)` en una transacción con app.set_context del tenant (SCRUM-1468): Core se conecta como
   * mani_core_svc, sin BYPASSRLS, y las políticas `cliente_tenant`, `usuario_tenant` y `sitio_tenant` (0007) solo
   * dejan ver y escribir filas del tenant fijado.
   */
  _enTenant(tenantId, trabajo) {
    if (this.pgPool) return enContextoTenant({ getPool: () => this.pgPool }, tenantId, trabajo);
    if (this.pgPoolFactory) return enContextoTenant(this.pgPoolFactory, tenantId, trabajo);
    throw new DomainError('DATABASE_URL no configurada: se requiere conexión PostgreSQL.', 'DATABASE_NOT_CONFIGURED', 500);
  }

  /**
   * Guarda cliente empresa y sus sitios de manera transaccional.
   * @param {CompanyClient} companyClient
   * @param {Site[]} sites
   * @param {object} [options]
   * @param {string} [options.userId]
   * @returns {Promise<{ client: CompanyClient, sites: Site[] }>}
   */
  async save(companyClient, sites, { userId } = {}) {
    return this._enTenant(companyClient.tenantId, async (clientConn) => {
      const effectiveUserId = userId || crypto.randomUUID();
      const clientId = crypto.randomUUID();

      // 1. Insertar usuario base si no existe
      await clientConn.query(
        `INSERT INTO usuario (id, tenant_id, email, rol, estado, telefono, created_at)
         VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO', $4, NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           telefono = COALESCE(EXCLUDED.telefono, usuario.telefono)`,
        [effectiveUserId, companyClient.tenantId, companyClient.email, companyClient.telefono]
      );

      // 2. Insertar cliente empresa con columnas de organización (tipo PERSONA_JURIDICA per Migración 007)
      await clientConn.query(
        `INSERT INTO cliente (id, tenant_id, usuario_id, tipo, razon_social, nit, telefono, nombre_representante)
         VALUES ($1, $2, $3, 'PERSONA_JURIDICA', $4, $5, $6, $7)`,
        [
          clientId,
          companyClient.tenantId,
          effectiveUserId,
          companyClient.razonSocial,
          companyClient.nit,
          companyClient.telefono,
          companyClient.nombreRepresentante,
        ]
      );

      // 3. Insertar sitios
      const savedSites = [];
      for (const site of (sites || [])) {
        const siteId = site.id || crypto.randomUUID();
        const reglasJson = site.reglas ? JSON.stringify(site.reglas) : null;

        await clientConn.query(
          `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, contacto_nombre, contacto_telefono, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
          [
            siteId,
            companyClient.tenantId,
            clientId,
            site.zonaId,
            site.direccion,
            site.nombre,
            reglasJson,
            site.contactoNombre ?? null,
            site.contactoTelefono ?? null,
          ]
        );

        savedSites.push(
          new Site({
            id: siteId,
            tenantId: companyClient.tenantId,
            clienteId: clientId,
            nombre: site.nombre,
            direccion: site.direccion,
            zonaId: site.zonaId,
            contactoNombre: site.contactoNombre,
            contactoTelefono: site.contactoTelefono,
            reglas: site.reglas,
          })
        );
      }

      const savedClient = new CompanyClient({
        id: clientId,
        tenantId: companyClient.tenantId,
        razonSocial: companyClient.razonSocial,
        nit: companyClient.nit,
        email: companyClient.email,
        telefono: companyClient.telefono,
        nombreRepresentante: companyClient.nombreRepresentante,
        tipo: 'PERSONA_JURIDICA',
        estado: 'ACTIVO',
      });
      savedClient.usuarioId = effectiveUserId;

      return { client: savedClient, sites: savedSites };
    });
  }

  async findById(id, tenantId) {
    const { rows } = await this._consultar(
      tenantId,
      `SELECT c.id, c.tenant_id, c.usuario_id, c.razon_social, c.nit, c.telefono, c.nombre_representante, c.tipo, u.email, u.estado
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.tipo IN ('PERSONA_JURIDICA', 'EMPRESA')
       LIMIT 1`,
      [id, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  async findByUsuarioId(usuarioId, tenantId) {
    const { rows } = await this._consultar(
      tenantId,
      `SELECT c.id, c.tenant_id, c.usuario_id, c.razon_social, c.nit, c.telefono, c.nombre_representante, c.tipo, u.email, u.estado
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE c.usuario_id = $1 AND c.tenant_id = $2 AND c.tipo IN ('PERSONA_JURIDICA', 'EMPRESA')
       LIMIT 1`,
      [usuarioId, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  async findByNitAndTenant(nit, tenantId) {
    const { rows } = await this._consultar(
      tenantId,
      `SELECT c.id, c.tenant_id, c.usuario_id, c.razon_social, c.nit, c.telefono, c.nombre_representante, c.tipo, u.email, u.estado
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE c.nit = $1 AND c.tenant_id = $2 AND c.tipo IN ('PERSONA_JURIDICA', 'EMPRESA')
       LIMIT 1`,
      [nit, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  async findByEmailAndTenant(email, tenantId) {
    const { rows } = await this._consultar(
      tenantId,
      `SELECT c.id, c.tenant_id, c.usuario_id, c.razon_social, c.nit, c.telefono, c.nombre_representante, c.tipo, u.email, u.estado
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE LOWER(u.email) = LOWER($1) AND c.tenant_id = $2 AND c.tipo IN ('PERSONA_JURIDICA', 'EMPRESA')
       LIMIT 1`,
      [email, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  async addSite(clienteId, tenantId, site) {
    const siteId = site.id || crypto.randomUUID();
    const reglasJson = site.reglas ? JSON.stringify(site.reglas) : null;

    try {
      await this._consultar(
        tenantId,
        `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, contacto_nombre, contacto_telefono, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          siteId,
          tenantId,
          clienteId,
          site.zonaId,
          site.direccion,
          site.nombre,
          reglasJson,
          site.contactoNombre ?? null,
          site.contactoTelefono ?? null,
        ]
      );
    } catch (err) {
      throw traducirZonaInvalida(err);
    }

    return new Site({
      id: siteId,
      tenantId,
      clienteId,
      nombre: site.nombre,
      direccion: site.direccion,
      zonaId: site.zonaId,
      contactoNombre: site.contactoNombre,
      contactoTelefono: site.contactoTelefono,
      reglas: site.reglas,
    });
  }

  async findSitesByClientId(clienteId, tenantId) {
    const { rows } = await this._consultar(
      tenantId,
      `SELECT id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, contacto_nombre, contacto_telefono, latitud, longitud, created_at
       FROM sitio
       WHERE cliente_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [clienteId, tenantId]
    );

    return rows.map((r) => this._rowToSite(r));
  }

  async findSiteById(clienteId, siteId, tenantId) {
    const { rows } = await this._consultar(
      tenantId,
      `SELECT id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, contacto_nombre, contacto_telefono, latitud, longitud, created_at
       FROM sitio
       WHERE id = $1 AND cliente_id = $2 AND tenant_id = $3`,
      [siteId, clienteId, tenantId]
    );
    return rows.length > 0 ? this._rowToSite(rows[0]) : null;
  }

  async updateSite(clienteId, tenantId, site) {
    try {
      const { rows } = await this._consultar(
        tenantId,
        `UPDATE sitio
         SET nombre = $4, direccion = $5, zona_id = $6, contacto_nombre = $7, contacto_telefono = $8
         WHERE id = $1 AND cliente_id = $2 AND tenant_id = $3
         RETURNING id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, contacto_nombre, contacto_telefono, latitud, longitud, created_at`,
        [
          site.id,
          clienteId,
          tenantId,
          site.nombre,
          site.direccion,
          site.zonaId,
          site.contactoNombre ?? null,
          site.contactoTelefono ?? null,
        ]
      );
      return rows.length > 0 ? this._rowToSite(rows[0]) : null;
    } catch (err) {
      throw traducirZonaInvalida(err);
    }
  }

  _consultar(tenantId, sql, params) {
    return this._enTenant(tenantId, (client) => client.query(sql, params));
  }

  _rowToClient(row) {
    return new CompanyClient({
      id: row.id,
      usuarioId: row.usuario_id,
      tenantId: row.tenant_id,
      razonSocial: row.razon_social || row.email,
      nit: row.nit || '000000000',
      email: row.email,
      telefono: row.telefono || null,
      nombreRepresentante: row.nombre_representante || null,
      tipo: row.tipo || 'PERSONA_JURIDICA',
      estado: row.estado || 'ACTIVO',
    });
  }

  _rowToSite(row) {
    let reglas = row.reglas;
    if (typeof reglas === 'string') {
      try {
        reglas = JSON.parse(reglas);
      } catch {
        reglas = null;
      }
    }
    return new Site({
      id: row.id,
      tenantId: row.tenant_id,
      clienteId: row.cliente_id,
      nombre: row.nombre || row.direccion,
      direccion: row.direccion,
      zonaId: row.zona_id,
      contactoNombre: row.contacto_nombre ?? null,
      contactoTelefono: row.contacto_telefono ?? null,
      reglas,
      // `numeric` llega como cadena desde `pg`; la entidad la normaliza.
      latitud: row.latitud ?? null,
      longitud: row.longitud ?? null,
      creadoEn: row.created_at,
    });
  }
}

PostgresCompanyClientRepository.PostgresCompanyClientRepository = PostgresCompanyClientRepository;
module.exports = PostgresCompanyClientRepository;
