const { ForbiddenError, NotFoundError } = require('../../../domain/errors/DomainError');
const { ESTADO_VERIFICACION_TO_DB } = require('../../../infrastructure/repositories/supabaseEnumMaps');

/**
 * Perfil mínimo del aliado autenticado que Dispatch necesita para aceptar o rechazar una oferta (ADR-0030):
 * Dispatch ya no lee la tabla `aliado`. El tenant y el usuario salen solo del JWT verificado.
 * El estado se devuelve con el valor canónico del esquema (`VERIFICADO`, no el literal del dominio).
 */
class GetOwnAllyProfileUseCase {
  constructor({ aliadoRepository }) {
    if (!aliadoRepository) throw new Error('aliadoRepository es requerido para GetOwnAllyProfileUseCase');
    this.aliadoRepository = aliadoRepository;
  }

  async execute({ session = {} } = {}) {
    const { tenantId, userId, role } = session;
    if (!tenantId || !userId || role !== 'ALLY') {
      throw new ForbiddenError('MANI-DSP-403: solo un aliado autenticado puede consultar su perfil de aliado', 'MANI-DSP-403');
    }

    const aliado = await this.aliadoRepository.findByUsuarioId(tenantId, userId);
    if (!aliado) {
      throw new NotFoundError('MANI-DSP-404: no existe un perfil de aliado para la cuenta en este tenant', 'MANI-DSP-404');
    }

    const estado = aliado.estado_verificacion ?? aliado.estadoVerificacion;
    return {
      id: aliado.id,
      tenantId: aliado.tenant_id ?? aliado.tenantId ?? tenantId,
      usuarioId: aliado.usuario_id ?? aliado.usuarioId ?? userId,
      estadoVerificacion: ESTADO_VERIFICACION_TO_DB[estado] || estado,
    };
  }
}

module.exports = GetOwnAllyProfileUseCase;
