const { ValidationError } = require('../../../domain/errors/DomainError');
const LegalDocument = require('../../../domain/entities/LegalDocument');

const DEFAULT_GLOBAL_DOCS = [
  new LegalDocument({
    id: '00000000-0000-0000-0000-000000000001',
    tipo: 'TERMS_AND_CONDITIONS',
    version: '1.0',
    contenido: 'Términos y Condiciones Generales de MANI. Al utilizar la plataforma, acepta los términos de servicio.',
    isActive: true,
  }),
  new LegalDocument({
    id: '00000000-0000-0000-0000-000000000002',
    tipo: 'PRIVACY_POLICY',
    version: '1.0',
    contenido: 'Política de Tratamiento y Protección de Datos Personales (Ley 1581 de 2012 / Habeas Data). Autorizo el tratamiento de mis datos personales.',
    isActive: true,
  }),
];

class GetActiveLegalDocumentsUseCase {
  constructor({ legalDocumentRepository, tenantRepository }) {
    this.legalDocumentRepository = legalDocumentRepository;
    this.tenantRepository = tenantRepository;
  }

  async execute({ tenantSlug, tenantId } = {}) {
    let resolvedTenantId = tenantId || null;

    if (tenantSlug) {
      if (!this.tenantRepository) {
        throw new ValidationError('Tenant repository no inyectado', 'INTERNAL_ERROR');
      }
      const tenant = await this.tenantRepository.findBySlug(tenantSlug);
      if (!tenant) {
        throw new ValidationError(`El tenant con slug "${tenantSlug}" no existe`, 'TENANT_NOT_FOUND');
      }
      resolvedTenantId = tenant.id;
    }

    let docs = [];
    if (this.legalDocumentRepository) {
      docs = await this.legalDocumentRepository.getActiveDocuments(resolvedTenantId);
    }

    if (!docs || docs.length === 0) {
      docs = DEFAULT_GLOBAL_DOCS;
    }

    return docs;
  }
}

module.exports = GetActiveLegalDocumentsUseCase;
