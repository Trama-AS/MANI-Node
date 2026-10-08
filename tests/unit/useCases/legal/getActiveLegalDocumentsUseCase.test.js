const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const GetActiveLegalDocumentsUseCase = require('../../../../src/application/useCases/legal/GetActiveLegalDocumentsUseCase');
const LegalDocument = require('../../../../src/domain/entities/LegalDocument');
const InMemoryLegalDocumentRepository = require('../../../../src/infrastructure/repositories/InMemoryLegalDocumentRepository');

describe('GetActiveLegalDocumentsUseCase', () => {
  test('retorna documentos por defecto si el repositorio está vacío', async () => {
    const legalRepo = new InMemoryLegalDocumentRepository();
    const useCase = new GetActiveLegalDocumentsUseCase({
      legalDocumentRepository: legalRepo,
    });

    const docs = await useCase.execute({});
    assert.strictEqual(docs.length, 2);
    assert.strictEqual(docs[0].tipo, 'TERMS_AND_CONDITIONS');
    assert.strictEqual(docs[1].tipo, 'PRIVACY_POLICY');
  });

  test('retorna documentos activos del tenant cuando existen en el repositorio', async () => {
    const legalRepo = new InMemoryLegalDocumentRepository();
    await legalRepo.create(
      new LegalDocument({
        id: 'doc-123',
        tenantId: 'tenant-abc',
        tipo: 'TERMS_AND_CONDITIONS',
        version: '2.0',
        contenido: 'Términos específicos del Tenant ABC',
        isActive: true,
      })
    );

    const useCase = new GetActiveLegalDocumentsUseCase({
      legalDocumentRepository: legalRepo,
    });

    const docs = await useCase.execute({ tenantId: 'tenant-abc' });
    assert.strictEqual(docs.length, 3);
    const tenantDoc = docs.find((d) => d.id === 'doc-123');
    assert.ok(tenantDoc);
    assert.strictEqual(tenantDoc.version, '2.0');
  });

  test('resuelve el tenant por slug usando tenantRepository', async () => {
    const legalRepo = new InMemoryLegalDocumentRepository();
    const mockTenantRepo = {
      findBySlug: async (slug) => {
        if (slug === 'empresa-xyz') {
          return { id: 'tenant-xyz', slug: 'empresa-xyz' };
        }
        return null;
      },
    };

    const useCase = new GetActiveLegalDocumentsUseCase({
      legalDocumentRepository: legalRepo,
      tenantRepository: mockTenantRepo,
    });

    const docs = await useCase.execute({ tenantSlug: 'empresa-xyz' });
    assert.ok(docs.length > 0);
  });

  test('lanza error TENANT_NOT_FOUND si el slug no existe', async () => {
    const mockTenantRepo = {
      findBySlug: async () => null,
    };

    const useCase = new GetActiveLegalDocumentsUseCase({
      tenantRepository: mockTenantRepo,
    });

    await assert.rejects(
      async () => {
        await useCase.execute({ tenantSlug: 'no-existe' });
      },
      {
        message: 'El tenant con slug "no-existe" no existe',
      }
    );
  });
});
