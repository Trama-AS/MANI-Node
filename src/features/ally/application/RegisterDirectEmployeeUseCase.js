const { DirectEmployee } = require('../domain/DirectEmployee');

/**
 * Caso de Uso: Registrar Empleado Directo (SCRUM-850 / US-02.1.5 / RF-05)
 *
 * Regla de negocio clave: El empleado directo NO pasa por el flujo de
 * aprobación ni carga documentos KYC. Queda APROBADO de inmediato.
 */
class RegisterDirectEmployeeUseCase {
  /**
   * @param {import('./IDirectEmployeeRepository').IDirectEmployeeRepository} directEmployeeRepository
   */
  constructor(directEmployeeRepository) {
    this.repo = directEmployeeRepository;
  }

  /**
   * Ejecuta el registro de un empleado directo.
   * @param {object} input
   * @param {string} input.tenantId     - Extraído del JWT del admin
   * @param {string} input.nombre
   * @param {string} input.email
   * @param {string} [input.telefono]
   * @param {string} [input.fotoPerfil]
   * @param {string} [input.categoriaId]
   * @param {string} [input.zonaId]
   * @param {string} input.correlationId
   * @returns {Promise<{employee: DirectEmployee, isNew: boolean}>}
   */
  async execute({ tenantId, nombre, email, telefono, fotoPerfil, categoriaId, zonaId, correlationId }) {
    // 1. Construir la entidad de dominio (aplica valores por defecto y tipo)
    const employee = new DirectEmployee({
      id: undefined,   // Lo asignará la BD
      tenantId,
      nombre,
      email,
      telefono,
      fotoPerfil,
      categoriaId,
      zonaId,
    });

    // 2. Validar reglas del dominio
    employee.validate();

    // 3. Verificar duplicados dentro del mismo tenant (idempotencia)
    const existing = await this.repo.findByEmailAndTenant(email, tenantId);
    if (existing) {
      return { employee: existing, isNew: false };
    }

    // 4. Persistir — sin flujo KYC, sin documentos, directo a APROBADO
    const saved = await this.repo.save(employee);

    return { employee: saved, isNew: true };
  }
}

module.exports = { RegisterDirectEmployeeUseCase };
