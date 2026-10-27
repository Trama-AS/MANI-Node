/**
 * Interfaz / Puerto de Dominio para el catálogo geográfico de zonas.
 *
 * `zona` es un catálogo global compartido por todos los tenants (no tiene
 * columna tenant_id), así que ningún método recibe tenantId: hacerlo
 * sugeriría un filtro que la tabla no puede cumplir. La autorización vive en
 * el borde HTTP (JWT verificado, T4/T7).
 */
class IZoneRepository {
  /**
   * Catálogo completo, ordenado por nivel y nombre.
   * @param {{ onlyActive?: boolean }} [options]
   * @returns {Promise<import('../entities/Zone')[]>}
   */
  async findAll(_options) {
    throw new Error('Método findAll() no implementado en IZoneRepository');
  }

  /**
   * @returns {Promise<import('../entities/Zone')|null>} null si el id no existe.
   */
  async findById(_zoneId) {
    throw new Error('Método findById() no implementado en IZoneRepository');
  }
}

module.exports = IZoneRepository;
