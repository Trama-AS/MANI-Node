const AllyAbsence = require('../../../domain/entities/AllyAbsence');
const { DomainError } = require('../../../domain/errors/DomainError');
const resolveSessionAlly = require('./resolveSessionAlly');

const overlapError = () =>
  new DomainError('MANI-AUS-409: el intervalo se cruza con otra ausencia registrada', 'MANI-AUS-409', 409);

class CreateAllyAbsenceUseCase {
  constructor({ aliadoRepository, aliadoAusenciaRepository, clock = () => new Date() }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para CreateAllyAbsenceUseCase');
    }
    if (!aliadoAusenciaRepository) {
      throw new Error('aliadoAusenciaRepository es requerido para CreateAllyAbsenceUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoAusenciaRepository = aliadoAusenciaRepository;
    this.clock = clock;
  }

  async execute({ userId, tenantId, role, startsAt, endsAt, reason, note } = {}) {
    const ally = await resolveSessionAlly(this.aliadoRepository, { userId, tenantId, role });

    const absence = new AllyAbsence({ ...ally, startsAt, endsAt, reason, note });
    absence.assertNotFinished(this.clock());

    // La restricción ex_aliado_ausencia_solapamiento cubre la carrera entre dos
    // POST simultáneos; esta consulta da el error de negocio en el caso normal.
    const overlapping = await this.aliadoAusenciaRepository.findOverlapping(
      ally.tenantId,
      ally.aliadoId,
      absence.startsAt,
      absence.endsAt,
      null
    );
    if (overlapping.length > 0) throw overlapError();

    return this.aliadoAusenciaRepository.create(absence);
  }
}

CreateAllyAbsenceUseCase.overlapError = overlapError;

module.exports = CreateAllyAbsenceUseCase;
