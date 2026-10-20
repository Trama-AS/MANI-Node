/**
 * Interfaz / Puerto de Dominio para persistencia de consentimientos de usuario (Habeas Data).
 */
class IUserConsentRepository {
  /**
   * Registra un consentimiento de usuario para un documento legal.
   * @param {import('../entities/UserConsent')|object} _consent
   * @returns {Promise<import('../entities/UserConsent')>}
   */
  async create(_consent) {
    throw new Error('Método create() no implementado en IUserConsentRepository');
  }

  /**
   * Verifica si el usuario ya registró consentimiento para un documento legal específico.
   * @param {string} _usuarioId
   * @param {string} _documentoLegalId
   * @returns {Promise<boolean>}
   */
  async hasConsented(_usuarioId, _documentoLegalId) {
    throw new Error('Método hasConsented() no implementado en IUserConsentRepository');
  }

  /**
   * Compensación (B3 / SAGA local): elimina los consentimientos asociados a un usuario
   * si el registro falla en un paso posterior.
   * @param {string} _tenantId
   * @param {string} _usuarioId
   */
  async deleteByUsuarioId(_tenantId, _usuarioId) {
    throw new Error('Método deleteByUsuarioId() no implementado en IUserConsentRepository');
  }
}

module.exports = IUserConsentRepository;
