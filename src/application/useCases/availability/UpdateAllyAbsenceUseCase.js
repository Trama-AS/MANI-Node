const AllyAbsence = require('../../../domain/entities/AllyAbsence');
const { DomainError } = require('../../../domain/errors/DomainError');
const resolveSessionAlly = require('./resolveSessionAlly');
const { overlapError } = require('./CreateAllyAbsenceUseCase');

const notFound = () => new DomainError('MANI-AUS-404: ausencia no encontrada', 'MANI-AUS-404', 404);

class UpdateAllyAbsenceUseCase {
  constructor({ aliadoRepository, aliadoAusenciaRepository, clock = () => new Date() }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para UpdateAllyAbsenceUseCase');
    }
    if (!aliadoAusenciaRepository) {
      throw new Error('aliadoAusenciaRepository es requerido para UpdateAllyAbsenceUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoAusenciaRepository = aliadoAusenciaRepository;
    this.clock = clock;
  }

  /** Edición parcial: los campos que no llegan conservan su valor actual. */
  async execute({ userId, tenantId, role, absenceId, startsAt, endsAt, reason, note } = {}) {
    const ally = await resolveSessionAlly(this.aliadoRepository, { userId, tenantId, role });

    const current = absenceId
      ? await this.aliadoAusenciaRepository.findById(ally.tenantId, ally.aliadoId, absenceId)
      : null;
    if (!current) throw notFound();

    const updated = new AllyAbsence({
      ...ally,
      id: current.id,
      startsAt: startsAt ?? current.startsAt,
      endsAt: endsAt ?? current.endsAt,
      reason: reason ?? current.reason,
      note: note === undefined ? current.note : note,
    });
    updated.assertNotFinished(this.clock());

    const overlapping = await this.aliadoAusenciaRepository.findOverlapping(
      ally.tenantId,
      ally.aliadoId,
      updated.startsAt,
      updated.endsAt,
      current.id
    );
    if (overlapping.length > 0) throw overlapError();

    const saved = await this.aliadoAusenciaRepository.update(updated);
    if (!saved) throw notFound();
    return saved;
  }
}

UpdateAllyAbsenceUseCase.notFound = notFound;

module.exports = UpdateAllyAbsenceUseCase;
