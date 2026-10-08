const ILegalDocumentRepository = require('../../domain/ports/ILegalDocumentRepository');
const LegalDocument = require('../../domain/entities/LegalDocument');

class InMemoryLegalDocumentRepository extends ILegalDocumentRepository {
  constructor() {
    super();
    this.documents = [
      new LegalDocument({
        id: '00000000-0000-0000-0000-000000000001',
        tenantId: null,
        tipo: 'TERMS_AND_CONDITIONS',
        version: '1.0',
        contenido: 'Términos y Condiciones Generales de MANI.',
        isActive: true,
      }),
      new LegalDocument({
        id: '00000000-0000-0000-0000-000000000002',
        tenantId: null,
        tipo: 'PRIVACY_POLICY',
        version: '1.0',
        contenido: 'Política de Tratamiento y Protección de Datos Personales (Habeas Data).',
        isActive: true,
      }),
    ];
  }

  async getActiveDocuments(tenantId) {
    return this.documents.filter(
      (doc) => doc.isActive && (doc.tenantId === null || doc.tenantId === tenantId)
    );
  }

  async findById(id) {
    return this.documents.find((doc) => doc.id === id) || null;
  }

  async create(doc) {
    const record = doc instanceof LegalDocument ? doc : new LegalDocument(doc);
    this.documents.push(record);
    return record;
  }
}

module.exports = InMemoryLegalDocumentRepository;
