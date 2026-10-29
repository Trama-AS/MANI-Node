const { UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Bandeja de notificaciones del usuario autenticado (HU-M09-06, CONS-35): lo que el proveedor push le
 * entregó, o le habría entregado con el mock. Cualquier rol lee solo la suya; el tenant y el usuario salen
 * del JWT, nunca de la consulta.
 */
class ListMyInboxUseCase {
  constructor({ notificacionRepository, pushProvider }) {
    if (!notificacionRepository) throw new Error('notificacionRepository es requerido para ListMyInboxUseCase');
    if (!pushProvider) throw new Error('pushProvider es requerido para ListMyInboxUseCase');
    this.notificacionRepository = notificacionRepository;
    this.pushProvider = pushProvider;
  }

  async execute({ session = {}, query = {} }) {
    if (!session.tenantId || !UUID_RE.test(String(session.userId || ''))) {
      throw new UnauthorizedError('MANI-NOT-401: sesión sin usuario o tenant', 'MANI-NOT-401');
    }

    let limit = DEFAULT_LIMIT;
    if (query.limit !== undefined) {
      limit = Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ValidationError(`MANI-NOT-400: limit debe ser un entero entre 1 y ${MAX_LIMIT}`, 'MANI-NOT-400');
      }
    }

    const ctx = { tenantId: session.tenantId, userId: session.userId, role: session.role };
    const rows = await this.notificacionRepository.listForUser(ctx, { limit });
    return {
      proveedor: this.pushProvider.name,
      simulada: this.pushProvider.simulated === true,
      items: rows.map((row) => ({
        id: row.id,
        tipo: row.tipo,
        canal: row.canal,
        payload: row.payload,
        enviadoAt: toIso(row.enviadoAt),
        leidoAt: toIso(row.leidoAt),
      })),
    };
  }
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : value ?? null;
}

module.exports = ListMyInboxUseCase;
