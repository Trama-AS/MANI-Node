const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const RegisterUserConsentUseCase = require('../../../../src/application/useCases/legal/RegisterUserConsentUseCase');
const InMemoryUserConsentRepository = require('../../../../src/infrastructure/repositories/InMemoryUserConsentRepository');
const InMemoryLegalDocumentRepository = require('../../../../src/infrastructure/repositories/InMemoryLegalDocumentRepository');
const LegalDocument = require('../../../../src/domain/entities/LegalDocument');

describe('RegisterUserConsentUseCase', () => {
  test('lanza VALIDATION_ERROR si falta usuarioId', async () => {
    const useCase = new RegisterUserConsentUseCase({});
    await assert.rejects(
      async () => {
        await useCase.execute({ usuarioId: '' });
      },
      {
        message: 'usuarioId es requerido para registrar consentimiento',
      }
    );
  });

  test('registra consentimientos para documentos globales por defecto', async () => {
    const consentRepo = new InMemoryUserConsentRepository();
    const legalRepo = new InMemoryLegalDocumentRepository();
    const useCase = new RegisterUserConsentUseCase({
      userConsentRepository: consentRepo,
      legalDocumentRepository: legalRepo,
    });

    const consents = await useCase.execute({
      usuarioId: 'user-123',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    });

    assert.strictEqual(consents.length, 2);
    assert.strictEqual(consents[0].usuarioId, 'user-123');
    assert.strictEqual(consents[0].ipAddress, '192.168.1.1');
    assert.strictEqual(consents[0].userAgent, 'Mozilla/5.0');
  });

  test('registra consentimiento para documentos específicos indicados por ID', async () => {
    const consentRepo = new InMemoryUserConsentRepository();
    const legalRepo = new InMemoryLegalDocumentRepository();
    await legalRepo.create(
      new LegalDocument({
        id: 'doc-custom-1',
        tipo: 'SPECIAL_TERMS',
        version: '1.0',
        contenido: 'Contenido especial',
      })
    );

    const useCase = new RegisterUserConsentUseCase({
      userConsentRepository: consentRepo,
      legalDocumentRepository: legalRepo,
    });

    const consents = await useCase.execute({
      usuarioId: 'user-456',
      documentoLegalIds: ['doc-custom-1'],
    });

    assert.strictEqual(consents.length, 1);
    assert.strictEqual(consents[0].documentoLegalId, 'doc-custom-1');
  });

  test('no duplica consentimiento si el usuario ya lo aceptó previamente', async () => {
    const consentRepo = new InMemoryUserConsentRepository();
    const legalRepo = new InMemoryLegalDocumentRepository();
    const useCase = new RegisterUserConsentUseCase({
      userConsentRepository: consentRepo,
      legalDocumentRepository: legalRepo,
    });

    const firstTime = await useCase.execute({
      usuarioId: 'user-789',
    });
    assert.strictEqual(firstTime.length, 2);

    const secondTime = await useCase.execute({
      usuarioId: 'user-789',
    });
    assert.strictEqual(secondTime.length, 0);
  });
});
