const IAliadoAusenciaRepository = require('../../domain/ports/IAliadoAusenciaRepository');
const AllyAbsence = require('../../domain/entities/AllyAbsence');
const { DomainError } = require('../../domain/errors/DomainError');
const { enContextoTenant, fallaDeBase } = require('../db/enContextoTenant');

const COLUMNAS = 'id, tenant_id, aliado_id, inicio, fin, motivo, nota';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toEntity(row) {
  return new AllyAbsence({
    id: row.id,
    tenantId: row.tenant_id,
    aliadoId: row.aliado_id,
    startsAt: new Date(row.inicio),
    endsAt: new Date(row.fin),
    reason: row.motivo,
    note: row.nota,
  });
}

/**
 * Ausencias del aliado (SCRUM-855, ADR-0028) por `pg` como `mani_core_svc` (SCRUM-1468), con app.set_context del
 * tenant. Los errores de las restricciones de la tabla se traducen a los mismos códigos de dominio de antes.
 */
class PgAliadoAusenciaRepository extends IAliadoAusenciaRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgAliadoAusenciaRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findByAliadoId(tenantId, aliadoId, from = new Date()) {
    const filas = await this.#consultar(
      tenantId,
      `SELECT ${COLUMNAS} FROM aliado_ausencia
        WHERE tenant_id = $1 AND aliado_id = $2 AND fin > $3
        ORDER BY inicio ASC`,
      [tenantId, aliadoId, from.toISOString()],
      'Error consultando las ausencias del aliado'
    );
    return filas.map(toEntity);
  }

  async findById(tenantId, aliadoId, id) {
    if (!UUID_RE.test(String(id))) return null;
    const filas = await this.#consultar(
      tenantId,
      `SELECT ${COLUMNAS} FROM aliado_ausencia WHERE id = $1 AND tenant_id = $2 AND aliado_id = $3`,
      [id, tenantId, aliadoId],
      'Error consultando la ausencia del aliado'
    );
    return filas[0] ? toEntity(filas[0]) : null;
  }

  async findOverlapping(tenantId, aliadoId, startsAt, endsAt, excludeId = null) {
    const filas = await this.#consultar(
      tenantId,
      `SELECT ${COLUMNAS} FROM aliado_ausencia
        WHERE tenant_id = $1 AND aliado_id = $2 AND inicio < $3 AND fin > $4
          AND ($5::uuid IS NULL OR id <> $5::uuid)`,
      [tenantId, aliadoId, endsAt.toISOString(), startsAt.toISOString(), excludeId],
      'Error validando el solapamiento de ausencias'
    );
    return filas.map(toEntity);
  }

  async create(absence) {
    const filas = await this.#consultar(
      absence.tenantId,
      `INSERT INTO aliado_ausencia (tenant_id, aliado_id, inicio, fin, motivo, nota)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNAS}`,
      [absence.tenantId, absence.aliadoId, absence.startsAt.toISOString(), absence.endsAt.toISOString(), absence.reason, absence.note ?? null],
      'Error registrando la ausencia del aliado'
    );
    return toEntity(filas[0]);
  }

  async update(absence) {
    const filas = await this.#consultar(
      absence.tenantId,
      `UPDATE aliado_ausencia
          SET inicio = $4, fin = $5, motivo = $6, nota = $7, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND aliado_id = $3
        RETURNING ${COLUMNAS}`,
      [
        absence.id,
        absence.tenantId,
        absence.aliadoId,
        absence.startsAt.toISOString(),
        absence.endsAt.toISOString(),
        absence.reason,
        absence.note ?? null,
      ],
      'Error actualizando la ausencia del aliado'
    );
    return filas[0] ? toEntity(filas[0]) : null;
  }

  async delete(tenantId, aliadoId, id) {
    if (!UUID_RE.test(String(id))) return false;
    const filas = await this.#consultar(
      tenantId,
      'DELETE FROM aliado_ausencia WHERE id = $1 AND tenant_id = $2 AND aliado_id = $3 RETURNING id',
      [id, tenantId, aliadoId],
      'Error eliminando la ausencia del aliado'
    );
    return filas.length > 0;
  }

  async #consultar(tenantId, sql, params, mensaje) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) => client.query(sql, params));
      return rows;
    } catch (err) {
      throw this.mapError(err, mensaje);
    }
  }

  mapError(error, message) {
    if (error && error.code === '23P01') {
      return new DomainError('MANI-AUS-409: el intervalo se cruza con otra ausencia registrada', 'MANI-AUS-409', 409);
    }
    if (error && error.code === '23514') {
      return new DomainError('MANI-AUS-422H: horario de ausencia inválido', 'MANI-AUS-422H', 422);
    }
    if (error && error.code === '23503') {
      return new DomainError('MANI-AUS-403: solo un aliado puede gestionar su disponibilidad', 'MANI-AUS-403', 403);
    }
    return fallaDeBase(message, error);
  }
}

module.exports = PgAliadoAusenciaRepository;
