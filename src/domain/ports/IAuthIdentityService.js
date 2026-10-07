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
}

module.exports = IAuthIdentityService;
