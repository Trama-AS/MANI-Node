const crypto = require('crypto');
const { CompanyClient } = require('../domain/CompanyClient');
const { Site } = require('../domain/Site');
const { ICompanyClientRepository } = require('../application/ICompanyClientRepository');
const { DomainError } = require('../../../domain/errors/DomainError');

/**
 * Adaptador de Infraestructura: Repositorio PostgreSQL / Supabase para Cliente Empresa y Sitios (RF-08 / RF-09).
 * Implementa ICompanyClientRepository con transacciones reales y aislamiento multitenant estricto.
 */
class PostgresCompanyClientRepository extends ICompanyClientRepository {
  /**
   * @param {object} params
   * @param {import('../../db/PgPoolFactory')} [params.pgPoolFactory]
   * @param {import('pg').Pool} [params.pgPool]
   */
  constructor({ pgPoolFactory, pgPool } = {}) {
    super();
    this.pgPoolFactory = pgPoolFactory;
    this.pgPool = pgPool;
  }

  _getPool() {
    if (this.pgPool) return this.pgPool;
    if (this.pgPoolFactory) return this.pgPoolFactory.getPool();
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
    const pool = this._getPool();
    const clientConn = await pool.connect();

    try {
      await clientConn.query('BEGIN');

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
          `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
          [siteId, companyClient.tenantId, clientId, site.zonaId, site.direccion, site.nombre, reglasJson]
        );

        savedSites.push(
          new Site({
            id: siteId,
            tenantId: companyClient.tenantId,
            clienteId: clientId,
            nombre: site.nombre,
            direccion: site.direccion,
            zonaId: site.zonaId,
            reglas: site.reglas,
          })
        );
      }

      await clientConn.query('COMMIT');

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
    } catch (err) {
      await clientConn.query('ROLLBACK');
      throw err;
    } finally {
      clientConn.release();
    }
  }

  async findById(id, tenantId) {
    const pool = this._getPool();
    const { rows } = await pool.query(
      `SELECT c.id, c.tenant_id, c.usuario_id, c.razon_social, c.nit, c.telefono, c.nombre_representante, c.tipo, u.email, u.estado
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.tipo IN ('PERSONA_JURIDICA', 'EMPRESA')
       LIMIT 1`,
      [id, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  async findByNitAndTenant(nit, tenantId) {
    const pool = this._getPool();
    const { rows } = await pool.query(
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
    const pool = this._getPool();
    const { rows } = await pool.query(
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
    const pool = this._getPool();
    const siteId = site.id || crypto.randomUUID();
    const reglasJson = site.reglas ? JSON.stringify(site.reglas) : null;

    await pool.query(
      `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [siteId, tenantId, clienteId, site.zonaId, site.direccion, site.nombre, reglasJson]
    );

    return new Site({
      id: siteId,
      tenantId,
      clienteId,
      nombre: site.nombre,
      direccion: site.direccion,
      zonaId: site.zonaId,
      reglas: site.reglas,
    });
  }

  async findSitesByClientId(clienteId, tenantId) {
    const pool = this._getPool();
    const { rows } = await pool.query(
      `SELECT id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at
       FROM sitio
       WHERE cliente_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [clienteId, tenantId]
    );

    return rows.map((r) => this._rowToSite(r));
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
      reglas,
      creadoEn: row.created_at,
    });
  }
}

module.exports = { PostgresCompanyClientRepository };
