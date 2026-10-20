const resolveSessionAlly = require('./resolveSessionAlly');
const { notFound } = require('./UpdateAllyAbsenceUseCase');

class DeleteAllyAbsenceUseCase {
  constructor({ aliadoRepository, aliadoAusenciaRepository }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para DeleteAllyAbsenceUseCase');
    }
    if (!aliadoAusenciaRepository) {
      throw new Error('aliadoAusenciaRepository es requerido para DeleteAllyAbsenceUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoAusenciaRepository = aliadoAusenciaRepository;
  }

  /** Borrar la ausencia devuelve al aliado a "Disponible" de inmediato. */
  async execute({ userId, tenantId, role, absenceId } = {}) {
    const ally = await resolveSessionAlly(this.aliadoRepository, { userId, tenantId, role });
    const deleted = absenceId
      ? await this.aliadoAusenciaRepository.delete(ally.tenantId, ally.aliadoId, absenceId)
      : false;
    if (!deleted) throw notFound();
  }
}

module.exports = DeleteAllyAbsenceUseCase;
