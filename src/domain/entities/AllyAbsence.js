const { DomainError } = require('../errors/DomainError');

const REASONS = ['VACACIONES', 'ENFERMEDAD', 'OTRO'];
const MAX_NOTE_LENGTH = 280;
const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
// Se exige zona horaria explícita (Z o ±HH:MM): sin ella "2026-10-20T08:00"
// significa una hora distinta según el servidor que la lea.
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

const invalidFormat = (field) =>
  new DomainError(
    `MANI-AUS-422V: ${field} debe ser una fecha ISO-8601 con zona horaria`,
    'MANI-AUS-422V',
    422
  );
const invalidSchedule = (detail) => new DomainError(`MANI-AUS-422H: ${detail}`, 'MANI-AUS-422H', 422);

function parseInstant(value, field) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalidFormat(field);
    return value;
  }
  if (typeof value !== 'string' || !ISO_WITH_ZONE_RE.test(value)) throw invalidFormat(field);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw invalidFormat(field);
  return date;
}

/**
 * Intervalo en el que el aliado está "No disponible" (US-02.1.6). Es
 * semiabierto [startsAt, endsAt), igual que la restricción de exclusión de
 * aliado_ausencia (db/migrations/0002_add_aliado_ausencia.sql).
 */
class AllyAbsence {
  constructor({ id = null, tenantId, aliadoId, startsAt, endsAt, reason, note = null }) {
    this.id = id;
    this.tenantId = tenantId;
    this.aliadoId = aliadoId;
    this.startsAt = parseInstant(startsAt, 'startsAt');
    this.endsAt = parseInstant(endsAt, 'endsAt');

    if (!REASONS.includes(reason)) {
      throw new DomainError(
        `MANI-AUS-422V: reason debe ser uno de ${REASONS.join(', ')}`,
        'MANI-AUS-422V',
        422
      );
    }
    this.reason = reason;

    if (note !== null && note !== undefined && typeof note !== 'string') {
      throw new DomainError('MANI-AUS-422V: note debe ser texto', 'MANI-AUS-422V', 422);
    }
    const cleanNote = typeof note === 'string' ? note.trim() : '';
    if (cleanNote.length > MAX_NOTE_LENGTH) {
      throw new DomainError(
        `MANI-AUS-422V: note admite máximo ${MAX_NOTE_LENGTH} caracteres`,
        'MANI-AUS-422V',
        422
      );
    }
    this.note = cleanNote === '' ? null : cleanNote;

    if (this.startsAt.getTime() >= this.endsAt.getTime()) {
      throw invalidSchedule('la fecha de fin debe ser posterior a la de inicio');
    }
    if (this.endsAt.getTime() - this.startsAt.getTime() > MAX_DURATION_MS) {
      throw invalidSchedule('una ausencia no puede durar más de 365 días');
    }
  }

  /** Una ausencia que ya terminó no tiene efecto sobre la elegibilidad: no se crea ni se edita hacia el pasado. */
  assertNotFinished(now = new Date()) {
    if (this.endsAt.getTime() <= now.getTime()) {
      throw invalidSchedule('la ausencia debe terminar en el futuro');
    }
  }

  overlaps(other) {
    return this.startsAt.getTime() < other.endsAt.getTime() && other.startsAt.getTime() < this.endsAt.getTime();
  }

  isActiveAt(instant = new Date()) {
    return this.startsAt.getTime() <= instant.getTime() && instant.getTime() < this.endsAt.getTime();
  }

  toJSON() {
    return {
      id: this.id,
      startsAt: this.startsAt.toISOString(),
      endsAt: this.endsAt.toISOString(),
      reason: this.reason,
      note: this.note,
      active: this.isActiveAt(),
    };
  }
}

AllyAbsence.REASONS = REASONS;

module.exports = AllyAbsence;
