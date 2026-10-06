const container = require('../container');

/**
 * Servicio de Perfiles (Fachada hacia GetOwnProfileUseCase para compatibilidad)
 */
async function getOwnProfile(userId) {
  return container.getOwnProfileUseCase.execute({ userId });
}

module.exports = { getOwnProfile };

