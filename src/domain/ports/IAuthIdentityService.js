/**
 * Interfaz / Puerto de Dominio para la identidad de autenticación (Supabase Auth
 * en QA/producción; un emisor de JWT propio en DEV/test). Crea al usuario que
 * puede iniciar sesión y emite la sesión (tokens) — separado de IUsuarioRepository,
 * que solo persiste el espejo de negocio en `public.usuario`.
 */
class IAuthIdentityService {
  /**
   * @returns {Promise<{ userId: string, accessToken: string, refreshToken: string, expiresIn: number }>}
   */
  async createIdentity(_params) {
    throw new Error('Método createIdentity() no implementado en IAuthIdentityService');
  }
}

module.exports = IAuthIdentityService;
