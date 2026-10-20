const { assertAdminSession, hydrateAllyVerificationView } = require('./allyVerificationMapper');

/**
 * US-02.1.3-M2 (SCRUM-1066) - CA-1, CA-6, CA-7:
 * Lista los aliados del tenant del administrador autenticado para la bandeja
 * de verificación (orden FIFO por fecha de registro), aislando estrictamente
 * los registros de otros tenants.
 */
class ListAlliesVerificationUseCase {
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

  async execute({ userId, tenantId, role, estadoVerificacion } = {}) {
    assertAdminSession({ userId, tenantId, role });

    const aliados = await this.aliadoRepository.findByTenant(tenantId, {
      estadoVerificacion,
    });

    const items = await Promise.all(
      aliados.map((aliado) =>
        hydrateAllyVerificationView({
          tenantId,
          aliado,
          usuarioRepository: this.usuarioRepository,
          aliadoCategoriaRepository: this.aliadoCategoriaRepository,
          catalogRepository: this.catalogRepository,
          documentoKycRepository: this.documentoKycRepository,
        })
      )
    );

    return items;
  }
}

module.exports = ListAlliesVerificationUseCase;
