/**
 * Interfaz / Puerto de Dominio para la identidad de autenticación (Supabase Auth
 * en QA/producción; un emisor de JWT propio en DEV/test).
 *
 * Separado en dos pasos a propósito: el Custom Access Token Hook de Supabase
 * (CFG-12) deriva tenant_id/rol leyendo la fila de `public.usuario`, así que
 * esa fila debe existir ANTES de la primera emisión de sesión — createUser()
 * solo crea la cuenta (auth.users); authenticate() se llama después de que el
 * caller ya insertó usuario/aliado, y es ahí cuando se emite la sesión real.
 */
class IAuthIdentityService {
  /** @returns {Promise<{ userId: string }>} */
  async createUser(_params) {
    throw new Error('Método createUser() no implementado en IAuthIdentityService');
  }

  /** @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number }>} */
  async authenticate(_params) {
    throw new Error('Método authenticate() no implementado en IAuthIdentityService');
  }

  /** Compensación (B3): deshace createUser() si un paso posterior del registro falla. */
  async deleteUser(_userId) {
    throw new Error('Método deleteUser() no implementado en IAuthIdentityService');
  }

  /**
   * Pide al proveedor de identidad que envíe el enlace de recuperación al correo (HU-M02-10). El proveedor
   * responde igual exista o no la cuenta.
   */
  async requestPasswordRecovery(_params) {
    throw new Error('Método requestPasswordRecovery() no implementado en IAuthIdentityService');
  }

  /**
   * Valida el token que trae el enlace de recuperación y devuelve a quién pertenece.
   * Lanza UnauthorizedError (INVALID_RECOVERY_TOKEN) si no es un token de recuperación vigente.
   * @returns {Promise<{ userId: string }>}
   */
  async resolveRecoveryUser(_accessToken) {
    throw new Error('Método resolveRecoveryUser() no implementado en IAuthIdentityService');
  }

  /** Fija la contraseña nueva de la cuenta y deja sin efecto el token de recuperación. */
  async updatePassword(_userId, _newPassword) {
    throw new Error('Método updatePassword() no implementado en IAuthIdentityService');
  }
}

module.exports = IAuthIdentityService;
