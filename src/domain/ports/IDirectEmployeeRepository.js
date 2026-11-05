/**
 * Puerto de persistencia del registro del empleado directo (RF-05, SCRUM-1376). Crea de una sola vez la fila de
 * usuario, la de aliado (tipo EMPLEADO_DIRECTO, ya VERIFICADO), sus categorías y la copia del documento de identidad.
 */
class IDirectEmployeeRepository {
  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado del administrador (JWT)
   * @param {{ usuarioId: string, email: string, phone: string, fullName: string, documentType: string,
   *   documentNumber: string, categoriaIds: string[], documento: { tipoDocumento: string, rutaStorage: string } }} _datos
   * @returns {Promise<{ aliadoId: string, documentoId: string|null }>}
   */
  async registrar(_ctx, _datos) {
    throw new Error('Método registrar() no implementado en IDirectEmployeeRepository');
  }
}

module.exports = IDirectEmployeeRepository;
