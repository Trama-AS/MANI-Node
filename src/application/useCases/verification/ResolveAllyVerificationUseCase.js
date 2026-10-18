const { DomainError, NotFoundError, ConflictError } = require('../../../domain/errors/DomainError');
const { assertAdminSession, hydrateAllyVerificationView } = require('./allyVerificationMapper');

function normalizeDecision(rawDecision) {
  const upper = String(rawDecision || '').trim().toUpperCase();
  if (upper === 'VERIFICADO' || upper === 'VERIFIED' || upper === 'APROBADO' || upper === 'APPROVED') {
    return 'VERIFICADO';
  }
  if (upper === 'RECHAZADO' || upper === 'REJECTED') {
    return 'RECHAZADO';
  }
  return null;
}

/**
 * US-02.1.3-M2 (SCRUM-1066) - CA-3, CA-4, CA-5, CA-6, CA-7:
 * Aprueba o rechaza el registro de un aliado pendiente dentro del tenant del
 * administrador autenticado, validando documentos KYC, motivo de rechazo
 * (10..500 caracteres), bloqueo de doble decisión concurrente (409) y registro
 * de auditoría con correlationId (RNF-04).
 */
class ResolveAllyVerificationUseCase {
  constructor({
    aliadoRepository,
    usuarioRepository,
    aliadoCategoriaRepository,
    catalogRepository,
    documentoKycRepository,
    auditLogger = (entry) => console.info(JSON.stringify(entry)),
  }) {
    this.aliadoRepository = aliadoRepository;
    this.usuarioRepository = usuarioRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.catalogRepository = catalogRepository;
    this.documentoKycRepository = documentoKycRepository;
    this.auditLogger = auditLogger;
  }

  async execute({ userId, tenantId, role, aliadoId, decision, motivo, correlationId = 'none' } = {}) {
    assertAdminSession({ userId, tenantId, role });

    const normalizedDecision = normalizeDecision(decision);
    if (!normalizedDecision) {
      throw new DomainError(
        `MANI-VER-422D: decisión inválida (${decision || ''})`,
        'MANI-VER-422D',
        422
      );
    }

    const cleanMotivo = typeof motivo === 'string' ? motivo.trim() : '';
    if (normalizedDecision === 'RECHAZADO' && (cleanMotivo.length < 10 || cleanMotivo.length > 500)) {
      throw new DomainError(
        'MANI-VER-422M: el motivo de rechazo es obligatorio y debe tener entre 10 y 500 caracteres',
        'MANI-VER-422M',
        422
      );
    }

    if (!aliadoId) {
      throw new NotFoundError('MANI-VER-404: aliado no encontrado', 'MANI-VER-404');
    }

    const aliado = await this.aliadoRepository.findById(tenantId, aliadoId);
    if (!aliado) {
      throw new NotFoundError('MANI-VER-404: aliado no encontrado', 'MANI-VER-404');
    }

    const currentStatus = String(aliado.estado_verificacion || aliado.estadoVerificacion || '').toUpperCase();
    if (currentStatus !== 'PENDIENTE' && currentStatus !== 'PENDING') {
      throw new ConflictError(
        `MANI-VER-409: la solicitud ya fue resuelta (${currentStatus})`,
        'MANI-VER-409'
      );
    }

    const canonicalAliadoId = aliado.id || aliadoId;
    const documentos = await this.documentoKycRepository.findByAliadoId(tenantId, canonicalAliadoId);
    if (normalizedDecision === 'VERIFICADO' && (!Array.isArray(documentos) || documentos.length === 0)) {
      throw new DomainError(
        'MANI-VER-422K: no se puede aprobar un aliado sin documentos KYC',
        'MANI-VER-422K',
        422
      );
    }

    const fechaVerificacion = new Date().toISOString();
    const internalStatus = normalizedDecision === 'VERIFICADO' ? 'VERIFIED' : 'REJECTED';

    const updatedAliado = await this.aliadoRepository.updateVerificationStatus(tenantId, canonicalAliadoId, {
      estadoVerificacion: internalStatus,
      motivoRechazo: normalizedDecision === 'RECHAZADO' ? cleanMotivo : null,
      fechaVerificacion,
      verificadoPor: userId,
    });

    if (!updatedAliado) {
      throw new ConflictError(
        'MANI-VER-409: la solicitud ya fue resuelta por otro administrador',
        'MANI-VER-409'
      );
    }

    await this.documentoKycRepository.updateStatusByAliadoId(tenantId, canonicalAliadoId, normalizedDecision);

    // CA-5 (RNF-04): Auditoría estructurada con quién, cuándo, decisión y correlationId (sin PII).
    this.auditLogger({
      event: 'US-02.1.3.resolver_verificacion',
      tenant_id: tenantId,
      aliado_id: canonicalAliadoId,
      verificado_por: userId,
      decision: normalizedDecision,
      fecha_verificacion: fechaVerificacion,
      correlation_id: correlationId,
    });

    return hydrateAllyVerificationView({
      tenantId,
      aliado: updatedAliado,
      usuarioRepository: this.usuarioRepository,
      aliadoCategoriaRepository: this.aliadoCategoriaRepository,
      catalogRepository: this.catalogRepository,
      documentoKycRepository: this.documentoKycRepository,
    });
  }
}

module.exports = ResolveAllyVerificationUseCase;
