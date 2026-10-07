const crypto = require('crypto');
const { CompanyClient } = require('../domain/CompanyClient');
const { Site } = require('../domain/Site');
const { ICompanyClientRepository } = require('../application/ICompanyClientRepository');

/**
 * Adaptador de Infraestructura: Repositorio PostgreSQL / Supabase para Cliente Empresa y Sitios (RF-08).
 * Implementa ICompanyClientRepository.
 *
 * Cuenta con un modo en memoria (fallback) para pruebas y ejecución local sin BD activa.
 */
class PostgresCompanyClientRepository extends ICompanyClientRepository {
  // Almacenamiento en memoria compartido entre instancias en entorno dev/test
  static _sharedClients = new Map();
  static _sharedSites = new Map();

  constructor() {
    super();
    this._inMemoryClients = PostgresCompanyClientRepository._sharedClients;
    this._inMemorySites = PostgresCompanyClientRepository._sharedSites;

    try {
      const { Pool } = require('pg');
      const connString =
        process.env.DATABASE_URL ||
        process.env.SUPABASE_DB_URL ||
        process.env.ConnectionStrings__DefaultConnection;

      if (connString) {
        this._pool = new Pool({ connectionString: connString });
        console.log('[PostgresCompanyClientRepository] Conectado a PostgreSQL.');
      } else {
        console.warn(
          '[PostgresCompanyClientRepository] Sin cadena de conexión — utilizando modo en memoria (in-memory fallback).'
        );
        this._pool = null;
      }
    } catch {
      this._pool = null;
    }
  }

  /**
   * Guarda cliente empresa y sus sitios de manera transaccional.
   * @param {CompanyClient} companyClient
   * @param {Site[]} sites
   * @returns {Promise<{ client: CompanyClient, sites: Site[] }>}
   */
  async save(companyClient, sites) {
    if (!this._pool) {
      return this._saveInMemory(companyClient, sites);
    }

    const clientConn = await this._pool.connect();
    try {
      await clientConn.query('BEGIN');

      const userId = crypto.randomUUID();
      const clientId = crypto.randomUUID();

      // 1. Insertar usuario base
      await clientConn.query(
        `INSERT INTO usuario (id, tenant_id, email, rol, estado, created_at)
         VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO', NOW())`,
        [userId, companyClient.tenantId, companyClient.email]
      );

      // 2. Insertar cliente empresa
      await clientConn.query(
        `INSERT INTO cliente (id, tenant_id, usuario_id, tipo)
         VALUES ($1, $2, $3, 'EMPRESA')`,
        [clientId, companyClient.tenantId, userId]
      );

      // 3. Insertar sitios
      const savedSites = [];
      for (const site of sites) {
        const siteId = crypto.randomUUID();
        const reglasJson = site.reglas ? JSON.stringify(site.reglas) : null;
        await clientConn.query(
          `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, reglas, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [siteId, companyClient.tenantId, clientId, site.zonaId, site.direccion, reglasJson]
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
        ...companyClient,
        id: clientId,
      });

      return { client: savedClient, sites: savedSites };
    } catch (err) {
      await clientConn.query('ROLLBACK');
      throw err;
    } finally {
      clientConn.release();
    }
  }

  /**
   * @param {string} id
   * @param {string} tenantId
   * @returns {Promise<CompanyClient|null>}
   */
  async findById(id, tenantId) {
    if (!this._pool) {
      for (const client of this._inMemoryClients.values()) {
        if (client.id === id && client.tenantId === tenantId) {
          return client;
        }
      }
      return null;
    }

    const { rows } = await this._pool.query(
      `SELECT c.id, c.tenant_id, u.email, c.tipo
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.tipo = 'EMPRESA' LIMIT 1`,
      [id, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  /**
   * @param {string} nit
   * @param {string} tenantId
   * @returns {Promise<CompanyClient|null>}
   */
  async findByNitAndTenant(nit, tenantId) {
    if (!this._pool) {
      for (const client of this._inMemoryClients.values()) {
        if (client.nit === nit && client.tenantId === tenantId) {
          return client;
        }
      }
      return null;
    }

    // Si la columna nit existe en metadatos o tabla cliente
    const { rows } = await this._pool.query(
      `SELECT c.id, c.tenant_id, u.email, c.tipo
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE c.tenant_id = $1 AND c.tipo = 'EMPRESA' LIMIT 1`,
      [tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  /**
   * @param {string} email
   * @param {string} tenantId
   * @returns {Promise<CompanyClient|null>}
   */
  async findByEmailAndTenant(email, tenantId) {
    if (!this._pool) {
      for (const client of this._inMemoryClients.values()) {
        if (client.email.toLowerCase() === email.toLowerCase() && client.tenantId === tenantId) {
          return client;
        }
      }
      return null;
    }

    const { rows } = await this._pool.query(
      `SELECT c.id, c.tenant_id, u.email, c.tipo
       FROM cliente c
       JOIN usuario u ON u.id = c.usuario_id
       WHERE LOWER(u.email) = LOWER($1) AND c.tenant_id = $2 AND c.tipo = 'EMPRESA' LIMIT 1`,
      [email, tenantId]
    );

    return rows.length > 0 ? this._rowToClient(rows[0]) : null;
  }

  /**
   * @param {string} clienteId
   * @param {string} tenantId
   * @param {Site} site
   * @returns {Promise<Site>}
   */
  async addSite(clienteId, tenantId, site) {
    if (!this._pool) {
      const siteId = `site-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const savedSite = new Site({
        ...site,
        id: siteId,
        clienteId,
        tenantId,
      });
      this._inMemorySites.set(siteId, savedSite);
      return savedSite;
    }

    const siteId = crypto.randomUUID();
    const reglasJson = site.reglas ? JSON.stringify(site.reglas) : null;
    await this._pool.query(
      `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, reglas, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [siteId, tenantId, clienteId, site.zonaId, site.direccion, reglasJson]
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

  /**
   * @param {string} clienteId
   * @param {string} tenantId
   * @returns {Promise<Site[]>}
   */
  async findSitesByClientId(clienteId, tenantId) {
    if (!this._pool) {
      const sites = [];
      for (const site of this._inMemorySites.values()) {
        if (site.clienteId === clienteId && site.tenantId === tenantId) {
          sites.push(site);
        }
      }
      return sites;
    }

    const { rows } = await this._pool.query(
      `SELECT id, tenant_id, cliente_id, zona_id, direccion, reglas, created_at
       FROM sitio
       WHERE cliente_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [clienteId, tenantId]
    );

    return rows.map((r) => this._rowToSite(r));
  }

  /**
   * @param {string} siteId
   * @param {string} tenantId
   * @returns {Promise<Site|null>}
   */
  async findSiteById(siteId, tenantId) {
    if (!this._pool) {
      const site = this._inMemorySites.get(siteId);
      if (site && site.tenantId === tenantId) {
        return site;
      }
      return null;
    }

    const { rows } = await this._pool.query(
      `SELECT id, tenant_id, cliente_id, zona_id, direccion, reglas, created_at
       FROM sitio
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [siteId, tenantId]
    );

    return rows.length > 0 ? this._rowToSite(rows[0]) : null;
  }

  /**
   * @param {string} siteId
   * @param {string} tenantId
   * @param {import('../domain/SiteRules').SiteRules|object} rules
   * @returns {Promise<Site>}
   */
  async updateSiteRules(siteId, tenantId, rules) {
    if (!this._pool) {
      const site = this._inMemorySites.get(siteId);
      if (!site || site.tenantId !== tenantId) {
        throw new Error(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`);
      }
      site.setRules(rules);
      this._inMemorySites.set(siteId, site);
      return site;
    }

    const reglasJson = typeof rules.toJSON === 'function'
      ? JSON.stringify(rules.toJSON())
      : JSON.stringify(rules);

    const { rows } = await this._pool.query(
      `UPDATE sitio
       SET reglas = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, tenant_id, cliente_id, zona_id, direccion, reglas, created_at`,
      [reglasJson, siteId, tenantId]
    );

    if (rows.length === 0) {
      throw new Error(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`);
    }

    return this._rowToSite(rows[0]);
  }

  // ── Helpers en memoria ───────────────────────────────────────────────────

  _saveInMemory(companyClient, sites) {
    const clientId = `comp-${Date.now()}`;
    const savedClient = new CompanyClient({
      ...companyClient,
      id: clientId,
    });
    this._inMemoryClients.set(clientId, savedClient);

    const savedSites = sites.map((s, index) => {
      const siteId = `site-${Date.now()}-${index}`;
      const savedSite = new Site({
        ...s,
        id: siteId,
        clienteId: clientId,
      });
      this._inMemorySites.set(siteId, savedSite);
      return savedSite;
    });

    return { client: savedClient, sites: savedSites };
  }

  _rowToClient(row) {
    return new CompanyClient({
      id: row.id,
      tenantId: row.tenant_id,
      razonSocial: row.razon_social || row.email,
      nit: row.nit || '000000000',
      email: row.email,
      telefono: row.telefono || null,
      nombreRepresentante: row.nombre_representante || null,
      tipo: row.tipo || 'EMPRESA',
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
      direccion: row.direccion,
      zonaId: row.zona_id,
      reglas,
      creadoEn: row.created_at,
    });
  }
}

module.exports = { PostgresCompanyClientRepository };
