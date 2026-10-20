const { NotFoundError } = require('../../../domain/errors/DomainError');
const { assertAdminSession, hydrateAllyVerificationView } = require('./allyVerificationMapper');

/**
 * US-02.1.3-M2 (SCRUM-1066) - CA-1, CA-2, CA-6, CA-7:
 * Obtiene el detalle de un aliado y sus documentos KYC acotado al tenant del
 * administrador autenticado. Si el aliado pertenece a otro tenant o no existe,
 * responde 404 MANI-VER-404 sin filtrar información cross-tenant (KI-05).
 */
class GetAllyVerificationDetailUseCase {
  constructor({
    aliadoRepository,
    usuarioRepository,
    aliadoCategoriaRepository,
    catalogRepository,
    documentoKycRepository,
  }) {
    this.aliadoRepository = aliadoRepository;
    this.usuarioRepository = usuarioRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.catalogRepository = catalogRepository;
    this.documentoKycRepository = documentoKycRepository;
  }

  async execute({ userId, tenantId, role, aliadoId } = {}) {
    assertAdminSession({ userId, tenantId, role });

    if (!aliadoId) {
      throw new NotFoundError('MANI-VER-404: aliado no encontrado', 'MANI-VER-404');
    }

    const aliado = await this.aliadoRepository.findById(tenantId, aliadoId);
    if (!aliado) {
      throw new NotFoundError('MANI-VER-404: aliado no encontrado', 'MANI-VER-404');
    }

    return hydrateAllyVerificationView({
      tenantId,
      aliado,
      usuarioRepository: this.usuarioRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      catalogRepository: this.catalogRepository,
      documentoKycRepository: this.documentoKycRepository,
    });
  }
}

module.exports = GetAllyVerificationDetailUseCase;
