/**
 * Interfaz / Puerto de Dominio para decodificación y verificación de tokens de autenticación.
 */
class ITokenService {
  verifyToken(_rawHeader) {
    throw new Error('Método verifyToken() no implementado en ITokenService');
  }
}

module.exports = ITokenService;

