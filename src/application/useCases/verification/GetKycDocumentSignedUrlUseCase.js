const { NotFoundError, ValidationError } = require('../../../domain/errors/DomainError');
const { assertAdminSession } = require('./allyVerificationMapper');

const DEFAULT_EXPIRES_IN_SECONDS = 300;

function pathBelongsToTenant(rutaStorage, tenantId) {
  const clean = String(rutaStorage || '')
    .trim()
    .replace(/^(kyc-documentos|kyc)\//, '');
  const segments = clean.split('/').filter(Boolean);
  return segments.length >= 2 && segments[0] === tenantId;
}

/**
 * US-02.1.3-M2 (SCRUM-1066) - CA-2, CA-6, CA-7:
 * Genera una URL firmada temporal para visualizar un documento KYC de un aliado,
 * garantizando que tanto el aliado como el path en Storage pertenezcan al
 * tenant del administrador autenticado (mitigación de KI-05 con service-role).
 */
class GetKycDocumentSignedUrlUseCase {
  constructor({ aliadoRepository, documentoKycRepository, fileStorageService }) {
    this.aliadoRepository = aliadoRepository;
    this.documentoKycRepository = documentoKycRepository;
    this.fileStorageService = fileStorageService;
  }

  async execute({ userId, tenantId, role, aliadoId, documentoId, rutaStorage, expiresInSeconds } = {}) {
    assertAdminSession({ userId, tenantId, role });

    let targetPath = rutaStorage ? String(rutaStorage).trim() : null;

    if (aliadoId) {
      const aliado = await this.aliadoRepository.findById(tenantId, aliadoId);
      if (!aliado) {
        throw new NotFoundError('MANI-VER-404: aliado no encontrado', 'MANI-VER-404');
      }

      const docs = await this.documentoKycRepository.findByAliadoId(tenantId, aliado.id || aliadoId);
      if (documentoId) {
        const doc = docs.find((d) => d.id === documentoId);
        if (!doc) {
          throw new NotFoundError('MANI-VER-404: documento KYC no encontrado', 'MANI-VER-404');
        }
        targetPath = doc.ruta_storage || doc.rutaStorage;
      } else if (targetPath) {
        const matchesAllyDoc = docs.some((d) => (d.ruta_storage || d.rutaStorage) === targetPath);
        if (!matchesAllyDoc) {
          throw new NotFoundError('MANI-VER-404: documento KYC no encontrado para el aliado', 'MANI-VER-404');
        }
      }
    }

    if (!targetPath) {
      throw new ValidationError('rutaStorage o documentoId es requerido', 'VALIDATION_ERROR');
    }

    if (!pathBelongsToTenant(targetPath, tenantId)) {
      throw new NotFoundError('MANI-VER-404: documento no encontrado en el tenant', 'MANI-VER-404');
    }

    const ttl = Number.isInteger(expiresInSeconds) && expiresInSeconds > 0 && expiresInSeconds <= 900
      ? expiresInSeconds
      : DEFAULT_EXPIRES_IN_SECONDS;

    const { signedUrl, expiresIn } = await this.fileStorageService.createSignedUrl(targetPath, ttl);

    return {
      url: signedUrl,
      signedUrl,
      expiresIn,
    };
  }
}

module.exports = GetKycDocumentSignedUrlUseCase;
