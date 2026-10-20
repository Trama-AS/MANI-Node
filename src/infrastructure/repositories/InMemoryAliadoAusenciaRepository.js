const { randomUUID } = require('node:crypto');
const IAliadoAusenciaRepository = require('../../domain/ports/IAliadoAusenciaRepository');
const AllyAbsence = require('../../domain/entities/AllyAbsence');

class InMemoryAliadoAusenciaRepository extends IAliadoAusenciaRepository {
  constructor() {
    super();
    this.ausencias = new Map(); // key: id
  }

  ownedBy(tenantId, aliadoId) {
    return [...this.ausencias.values()].filter((a) => a.tenantId === tenantId && a.aliadoId === aliadoId);
  }

  async findByAliadoId(tenantId, aliadoId, from = new Date()) {
    return this.ownedBy(tenantId, aliadoId)
      .filter((a) => a.endsAt.getTime() > from.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async findById(tenantId, aliadoId, id) {
    const absence = this.ausencias.get(id);
    if (!absence || absence.tenantId !== tenantId || absence.aliadoId !== aliadoId) return null;
    return absence;
  }

  async findOverlapping(tenantId, aliadoId, startsAt, endsAt, excludeId = null) {
    return this.ownedBy(tenantId, aliadoId).filter(
      (a) => a.id !== excludeId && a.startsAt.getTime() < endsAt.getTime() && startsAt.getTime() < a.endsAt.getTime()
    );
  }

  async create(absence) {
    const record = new AllyAbsence({ ...absence, id: randomUUID() });
    this.ausencias.set(record.id, record);
    return record;
  }

  async update(absence) {
    if (!(await this.findById(absence.tenantId, absence.aliadoId, absence.id))) return null;
    this.ausencias.set(absence.id, absence);
    return absence;
  }

  async delete(tenantId, aliadoId, id) {
    if (!(await this.findById(tenantId, aliadoId, id))) return false;
    return this.ausencias.delete(id);
  }
}

module.exports = InMemoryAliadoAusenciaRepository;
