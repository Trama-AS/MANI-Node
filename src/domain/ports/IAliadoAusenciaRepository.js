/**
 * Interfaz / Puerto de Dominio para persistencia de `aliado_ausencia`
 * (intervalos en los que el aliado está "No disponible", SCRUM-855).
 * Todas las operaciones reciben tenantId y aliadoId: una ausencia de otro
 * aliado o de otro tenant no existe para quien consulta.
 */
class IAliadoAusenciaRepository {
  /** Ausencias del aliado que terminan después de `from`, ordenadas por inicio. */
  async findByAliadoId(_tenantId, _aliadoId, _from) {
    throw new Error('Método findByAliadoId() no implementado en IAliadoAusenciaRepository');
  }

  async findById(_tenantId, _aliadoId, _id) {
    throw new Error('Método findById() no implementado en IAliadoAusenciaRepository');
  }

  /** Ausencias del aliado que se cruzan con [startsAt, endsAt), sin contar `excludeId`. */
  async findOverlapping(_tenantId, _aliadoId, _startsAt, _endsAt, _excludeId) {
    throw new Error('Método findOverlapping() no implementado en IAliadoAusenciaRepository');
  }

  async create(_absence) {
    throw new Error('Método create() no implementado en IAliadoAusenciaRepository');
  }

  async update(_absence) {
    throw new Error('Método update() no implementado en IAliadoAusenciaRepository');
  }

  /** Retorna true si borró la ausencia, false si no existía para ese aliado y tenant. */
  async delete(_tenantId, _aliadoId, _id) {
    throw new Error('Método delete() no implementado en IAliadoAusenciaRepository');
  }
}

module.exports = IAliadoAusenciaRepository;
