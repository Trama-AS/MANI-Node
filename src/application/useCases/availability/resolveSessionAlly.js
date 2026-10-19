const { DomainError } = require('../../../domain/errors/DomainError');

/**
 * Tenant y rol salen siempre del JWT (nunca del cuerpo): solo un aliado del
 * mismo tenant gestiona sus ausencias.
 */
async function resolveSessionAlly(aliadoRepository, { userId, tenantId, role } = {}) {
  if (!userId || !tenantId) {
    throw new DomainError('MANI-AUS-401: sesión requerida', 'MANI-AUS-401', 401);
  }
  if (role !== 'ALLY') {
    throw new DomainError('MANI-AUS-403: solo un aliado puede gestionar su disponibilidad', 'MANI-AUS-403', 403);
  }

  const aliado = await aliadoRepository.findByUsuarioId(tenantId, userId);
  if (!aliado) {
    throw new DomainError('MANI-AUS-403: solo un aliado puede gestionar su disponibilidad', 'MANI-AUS-403', 403);
  }
  return { tenantId, aliadoId: aliado.id || aliado.usuarioId || userId };
}

module.exports = resolveSessionAlly;
