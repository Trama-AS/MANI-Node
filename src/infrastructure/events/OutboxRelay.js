const { sobreDe } = require('../../domain/events/pagoRegistrado');

/**
 * Relay del outbox (ADR-0029): publica en Kafka los eventos pendientes, en orden de ocurrencia.
 *
 * Cada vuelta corre en UNA transacción: toma un lote con `SKIP LOCKED` (dos relays no toman los mismos eventos),
 * publica y recién entonces marca como publicados. Si publicar falla, hace ROLLBACK y registra el fallo en otra
 * transacción; el lote queda pendiente y se reintenta en la vuelta siguiente. La garantía es al menos una vez: si el
 * proceso muere después de publicar y antes de confirmar, el evento sale de nuevo, por eso todo consumidor deduplica
 * por `event_id` (CONTRATOS_EVENTOS.md §3, ARQ-08).
 */
class OutboxRelay {
  /**
   * @param {object} deps
   * @param {{ getPool: Function }} deps.pgPoolFactory
   * @param {{ publish: (mensajes: object[]) => Promise<void>, close?: () => Promise<void> }} deps.publisher
   */
  constructor({ pgPoolFactory, publisher, intervalMs = 2000, batchSize = 50, logger = console }) {
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para OutboxRelay');
    if (!publisher) throw new Error('publisher es requerido para OutboxRelay');
    this.pgPoolFactory = pgPoolFactory;
    this.publisher = publisher;
    this.intervalMs = intervalMs;
    this.batchSize = batchSize;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.enCurso = null;
  }

  /** Una vuelta. Devuelve cuántos eventos publicó. Nunca lanza: un fallo se registra y se reintenta. */
  async tick() {
    const pool = this.pgPoolFactory.getPool();
    if (!pool) return 0;
    const client = await pool.connect();
    let ids = [];
    let liberar;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM app.outbox_tomar_pendientes($1)', [this.batchSize]);
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      ids = rows.map((r) => r.id);
      await this.publisher.publish(
        rows.map((r) => ({ topic: r.topico, key: r.clave_particion, value: JSON.stringify(sobreDe(r)), eventId: r.id }))
      );
      await client.query('SELECT app.outbox_marcar_publicados($1::uuid[])', [ids]);
      await client.query('COMMIT');
      return ids.length;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        liberar = rollbackErr;
      }
      this.logger.error(`outbox: no se pudo publicar el lote (${ids.length} eventos): ${err.message}`);
      if (ids.length > 0) await this.#registrarFallo(ids, err.message);
      return 0;
    } finally {
      client.release(liberar);
    }
  }

  async #registrarFallo(ids, mensaje) {
    const client = await this.pgPoolFactory.getPool().connect();
    try {
      await client.query('SELECT app.outbox_registrar_fallo($1::uuid[], $2)', [ids, mensaje]);
    } catch (err) {
      this.logger.error(`outbox: tampoco se pudo registrar el fallo: ${err.message}`);
    } finally {
      client.release();
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const vuelta = async () => {
      if (!this.running) return;
      this.enCurso = this.tick();
      await this.enCurso;
      if (this.running) this.timer = setTimeout(vuelta, this.intervalMs);
    };
    this.timer = setTimeout(vuelta, 0);
  }

  /** Detiene el relay, espera la vuelta en curso y cierra la conexión con el broker. */
  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    // Comparación explícita: enCurso es una promesa y no debe usarse como condición booleana (Sonar S6544).
    if (this.enCurso !== null) await this.enCurso.catch(() => {});
    if (typeof this.publisher.close === 'function') await this.publisher.close();
  }
}

module.exports = OutboxRelay;
