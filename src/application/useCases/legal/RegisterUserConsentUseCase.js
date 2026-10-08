const { ValidationError } = require('../../../domain/errors/DomainError');
const UserConsent = require('../../../domain/entities/UserConsent');
const LegalDocument = require('../../../domain/entities/LegalDocument');

const DEFAULT_GLOBAL_DOCS = [
  new LegalDocument({
    id: '00000000-0000-0000-0000-000000000001',
    tipo: 'TERMS_AND_CONDITIONS',
    version: '1.0',
    contenido: 'Términos y Condiciones Generales de MANI.',
    isActive: true,
  }),
  new LegalDocument({
    id: '00000000-0000-0000-0000-000000000002',
    tipo: 'PRIVACY_POLICY',
    version: '1.0',
    contenido: 'Política de Tratamiento y Protección de Datos Personales (Habeas Data).',
    isActive: true,
  }),
];

class RegisterUserConsentUseCase {
  constructor({ legalDocumentRepository, userConsentRepository }) {
    this.legalDocumentRepository = legalDocumentRepository;
    this.userConsentRepository = userConsentRepository;
  }

  async execute({ tenantId = null, usuarioId, ipAddress = 'unknown', userAgent = 'unknown', documentoLegalIds = [] }) {
    if (!usuarioId || typeof usuarioId !== 'string') {
      throw new ValidationError('usuarioId es requerido para registrar consentimiento', 'VALIDATION_ERROR');
    }

    let targetDocs = [];

    if (Array.isArray(documentoLegalIds) && documentoLegalIds.length > 0) {
      for (const docId of documentoLegalIds) {
        let doc = null;
        if (this.legalDocumentRepository) {
          doc = await this.legalDocumentRepository.findById(docId);
        }
        if (!doc) {
          doc = DEFAULT_GLOBAL_DOCS.find((d) => d.id === docId) || new LegalDocument({ id: docId, tipo: 'CUSTOM' });
        }
        targetDocs.push(doc);
      }
    } else {
      if (this.legalDocumentRepository) {
        targetDocs = await this.legalDocumentRepository.getActiveDocuments(tenantId);
      }
      if (!targetDocs || targetDocs.length === 0) {
        targetDocs = DEFAULT_GLOBAL_DOCS;
      }
    }

    const savedConsents = [];

    for (const doc of targetDocs) {
      const alreadyConsented = this.userConsentRepository.hasConsented
        ? await this.userConsentRepository.hasConsented(usuarioId, doc.id)
        : false;

      if (!alreadyConsented) {
        const consent = new UserConsent({
          tenantId,
          usuarioId,
          documentoLegalId: doc.id,
          ipAddress: ipAddress || 'unknown',
          userAgent: userAgent || 'unknown',
        });

        const created = await this.userConsentRepository.create(consent);
        savedConsents.push(created);
      }
    }

    return savedConsents;
  }
}

module.exports = RegisterUserConsentUseCase;
