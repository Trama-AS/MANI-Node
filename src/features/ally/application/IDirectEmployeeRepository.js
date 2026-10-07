/**
 * Puerto (Interface): Repositorio de Empleados Directos
 * Define el contrato que la capa de infraestructura DEBE implementar.
 * La capa de aplicación solo depende de esta interface, no de Postgres ni de ningún ORM.
 */
class IDirectEmployeeRepository {
  /**
   * Persiste un nuevo empleado directo.
   * @param {import('../domain/DirectEmployee').DirectEmployee} employee
   * @returns {Promise<import('../domain/DirectEmployee').DirectEmployee>}
   */
  // eslint-disable-next-line no-unused-vars
  async save(employee) {
    throw new Error('IDirectEmployeeRepository.save() no implementado');
  }

  /**
   * Busca un empleado por email dentro del mismo tenant (para evitar duplicados).
   * @param {string} email
   * @param {string} tenantId
   * @returns {Promise<import('../domain/DirectEmployee').DirectEmployee|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async findByEmailAndTenant(email, tenantId) {
    throw new Error('IDirectEmployeeRepository.findByEmailAndTenant() no implementado');
  }
}

module.exports = { IDirectEmployeeRepository };
