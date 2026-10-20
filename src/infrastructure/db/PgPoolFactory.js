const { Pool } = require('pg');

/**
 * Crea y memoiza el pool de conexiones directas a PostgreSQL (DATABASE_URL).
 * Se usa solo donde hace falta una transacción real (supabase-js no la ofrece).
 * La cadena de conexión se lee exclusivamente desde config; nada vive aquí.
 * Para Supabase, el modo SSL se decide en la propia URL (`?sslmode=...`).
 */
class PgPoolFactory {
  constructor({ databaseUrl, max = 5 } = {}) {
    this.databaseUrl = databaseUrl;
    this.max = max;
    this.pool = null;
  }

  isConfigured() {
    return Boolean(this.databaseUrl);
  }

  getPool() {
    if (!this.isConfigured()) {
      return null;
    }

    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        max: this.max,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
      // Un cliente inactivo que pierde la conexión emite 'error'; sin este
      // manejador el proceso termina por una excepción no capturada.
      this.pool.on('error', (err) => {
        console.error(`⚠️  Error en un cliente inactivo del pool de PostgreSQL: ${err.message}`);
      });
    }

    return this.pool;
  }

  async close() {
    if (this.pool) {
      const pool = this.pool;
      this.pool = null;
      await pool.end();
    }
  }
}

module.exports = PgPoolFactory;
