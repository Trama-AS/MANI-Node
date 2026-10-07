const { DirectEmployee } = require('../domain/DirectEmployee');
const { IDirectEmployeeRepository } = require('../application/IDirectEmployeeRepository');

/**
 * Adaptador (Infraestructura): Repositorio de Empleados Directos para PostgreSQL/Supabase.
 * Implementa IDirectEmployeeRepository usando el cliente `pg` (a través de variables de entorno).
 *
 * Si no hay conexión a base de datos (modo desarrollo local), cae en modo fallback en memoria.
 */
class PostgresDirectEmployeeRepository extends IDirectEmployeeRepository {
  constructor() {
    super();
    this._inMemory = new Map(); // Fallback para desarrollo local sin BD

    try {
      const { Pool } = require('pg');
      const connString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.ConnectionStrings__DefaultConnection;

      if (connString) {
        this._pool = new Pool({ connectionString: connString });
        console.log('[PostgresDirectEmployeeRepository] Conectado a PostgreSQL.');
      } else {
        console.warn('[PostgresDirectEmployeeRepository] Sin cadena de conexión — usando modo en memoria (development fallback).');
        this._pool = null;
      }
    } catch {
      this._pool = null;
    }
  }

  /**
   * @param {DirectEmployee} employee
   * @returns {Promise<DirectEmployee>}
   */
  async save(employee) {
    if (!this._pool) return this._saveInMemory(employee);

    const { rows } = await this._pool.query(
      `INSERT INTO aliado (tenant_id, nombre, email, telefono, foto_perfil, tipo_aliado, estado_verificacion, categoria_id, zona_id, creado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [
        employee.tenantId,
        employee.nombre,
        employee.email,
        employee.telefono,
        employee.fotoPerfil,
        employee.tipoAliado,
        employee.estadoVerificacion,
        employee.categoriaId,
        employee.zonaId,
      ]
    );

    return this._rowToEntity(rows[0]);
  }

  /**
   * @param {string} email
   * @param {string} tenantId
   * @returns {Promise<DirectEmployee|null>}
   */
  async findByEmailAndTenant(email, tenantId) {
    if (!this._pool) return this._findInMemory(email, tenantId);

    const { rows } = await this._pool.query(
      `SELECT * FROM aliado WHERE email = $1 AND tenant_id = $2 AND tipo_aliado = 'EMPLEADO_DIRECTO' LIMIT 1`,
      [email, tenantId]
    );

    return rows.length > 0 ? this._rowToEntity(rows[0]) : null;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  _rowToEntity(row) {
    return new DirectEmployee({
      id: row.id,
      tenantId: row.tenant_id,
      nombre: row.nombre,
      email: row.email,
      telefono: row.telefono,
      fotoPerfil: row.foto_perfil,
      categoriaId: row.categoria_id,
      zonaId: row.zona_id,
      creadoEn: row.creado_en,
    });
  }

  _saveInMemory(employee) {
    const key = `${employee.tenantId}:${employee.email}`;
    const withId = new DirectEmployee({ ...employee, id: `emp-${Date.now()}` });
    this._inMemory.set(key, withId);
    return withId;
  }

  _findInMemory(email, tenantId) {
    return this._inMemory.get(`${tenantId}:${email}`) ?? null;
  }
}

module.exports = { PostgresDirectEmployeeRepository };
