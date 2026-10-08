const crypto = require('crypto');
const ISiteRepository = require('../../domain/ports/ISiteRepository');
const Site = require('../../domain/entities/Site');
const SiteRules = require('../../domain/entities/SiteRules');
const { DomainError } = require('../../domain/errors/DomainError');

class PostgresSiteRepository extends ISiteRepository {
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

  _getPool() {
    if (this.pgPool) return this.pgPool;
    if (this.pgPoolFactory) return this.pgPoolFactory.getPool();
    throw new DomainError('DATABASE_URL no configurada: se requiere conexión PostgreSQL.', 'DATABASE_NOT_CONFIGURED', 500);
  }

  async findById(id, tenantId) {
    const pool = this._getPool();
    const { rows } = await pool.query(
      `SELECT id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at
       FROM sitio
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [id, tenantId]
    );

    return rows.length > 0 ? this._rowToSite(rows[0]) : null;
  }

  async updateRules(id, tenantId, rules) {
    const pool = this._getPool();
    const rulesInstance = rules instanceof SiteRules ? rules : new SiteRules(rules);
    const reglasJson = JSON.stringify(rulesInstance.toJSON());

    const { rows } = await pool.query(
      `UPDATE sitio
       SET reglas = $1::jsonb
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at`,
      [reglasJson, id, tenantId]
    );

    if (rows.length === 0) {
      throw new DomainError(`Sitio con ID "${id}" no encontrado en tenant "${tenantId}".`, 'SITE_NOT_FOUND', 404);
    }

    return this._rowToSite(rows[0]);
  }

  async create(site) {
    const pool = this._getPool();
    const id = site.id || crypto.randomUUID();
    const reglasJson = site.reglas ? JSON.stringify(site.reglas) : null;

    const { rows } = await pool.query(
      `INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING id, tenant_id, cliente_id, zona_id, direccion, nombre, reglas, created_at`,
      [id, site.tenantId, site.clienteId, site.zonaId, site.direccion, site.nombre, reglasJson]
    );

    return this._rowToSite(rows[0]);
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
      reglas: reglas ? new SiteRules(reglas) : null,
      creadoEn: row.created_at,
    });
  }
}

module.exports = PostgresSiteRepository;
