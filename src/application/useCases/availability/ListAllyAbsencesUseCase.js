const resolveSessionAlly = require('./resolveSessionAlly');

class ListAllyAbsencesUseCase {
  constructor({ aliadoRepository, aliadoAusenciaRepository, clock = () => new Date() }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para ListAllyAbsencesUseCase');
    }
    if (!aliadoAusenciaRepository) {
      throw new Error('aliadoAusenciaRepository es requerido para ListAllyAbsencesUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoAusenciaRepository = aliadoAusenciaRepository;
    this.clock = clock;
  }

  /** Ausencias vigentes y futuras; las ya terminadas no afectan la elegibilidad. */
  async execute(session = {}) {
    const { tenantId, aliadoId } = await resolveSessionAlly(this.aliadoRepository, session);
    const now = this.clock();
    const absences = await this.aliadoAusenciaRepository.findByAliadoId(tenantId, aliadoId, now);
    return {
      absences,
      availableNow: !absences.some((absence) => absence.isActiveAt(now)),
    };
  }
}

module.exports = ListAllyAbsencesUseCase;
