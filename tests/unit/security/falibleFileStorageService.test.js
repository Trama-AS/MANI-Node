// SCRUM-1662 (T-25, QAS-09): Storage de KYC con falla inyectable y compensación del registro.
const test = require('node:test');
const assert = require('node:assert/strict');
const FalibleFileStorageService = require('../../../src/infrastructure/security/FalibleFileStorageService');
const InMemoryFileStorageService = require('../../../src/infrastructure/security/InMemoryFileStorageService');
const RegisterAllyNaturalPersonUseCase = require('../../../src/application/useCases/auth/RegisterAllyNaturalPersonUseCase');

test('sin operaciones configuradas se comporta como el servicio interno', async () => {
  const interno = new InMemoryFileStorageService();
  const storage = new FalibleFileStorageService({ interno });
  await storage.upload({ path: 'a/b.pdf', buffer: Buffer.from('x') });
  assert.ok(interno.files.has('a/b.pdf'));
  await storage.delete('a/b.pdf');
  assert.ok(!interno.files.has('a/b.pdf'));
});

test('upload falla desde la primera llamada por omisión, con un 503 y sin guardar nada', async () => {
  const interno = new InMemoryFileStorageService();
  const storage = new FalibleFileStorageService({ interno, operaciones: ['upload'] });
  await assert.rejects(storage.upload({ path: 'a.pdf', buffer: Buffer.from('x') }), (e) => e.statusCode === 503 && /MANI-STG-503/.test(e.message));
  assert.equal(interno.files.size, 0);
  // Las demás operaciones siguen funcionando.
  await storage.delete('a.pdf');
});

test('despuesDe deja pasar las primeras llamadas y falla las siguientes', async () => {
  const interno = new InMemoryFileStorageService();
  const storage = new FalibleFileStorageService({ interno, operaciones: ['upload'], despuesDe: 1 });
  await storage.upload({ path: 'uno.pdf', buffer: Buffer.from('1') });
  await assert.rejects(storage.upload({ path: 'dos.pdf', buffer: Buffer.from('2') }), (e) => e.statusCode === 503);
  assert.deepEqual([...interno.files.keys()], ['uno.pdf']);
});

test('una operación desconocida detiene la construcción en lugar de ignorarse', () => {
  assert.throws(() => new FalibleFileStorageService({ interno: new InMemoryFileStorageService(), operaciones: ['subir'] }), /operación desconocida/);
});

test('compensación: si el segundo documento KYC falla al subir, el registro borra el primero y la identidad, y relanza el error', async () => {
  const interno = new InMemoryFileStorageService();
  const fileStorageService = new FalibleFileStorageService({ interno, operaciones: ['upload'], despuesDe: 1 });
  const llamadas = [];
  const docs = [
    { tipoDocumento: 'CEDULA_CIUDADANIA', filename: 'cedula.pdf', contentType: 'application/pdf', buffer: Buffer.from('1') },
    { tipoDocumento: 'RUT', filename: 'rut.pdf', contentType: 'application/pdf', buffer: Buffer.from('2') },
  ];
  const useCase = new RegisterAllyNaturalPersonUseCase({
    tenantRepository: { findBySlug: async () => ({ id: 'trama-demo', slug: 'trama-demo', name: 'Demo', status: 'ACTIVE', isActive: () => true }) },
    catalogRepository: { findById: async () => ({ id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18', isActive: () => true }) },
    usuarioRepository: { findByEmail: async () => null, create: async (u) => u, deleteById: async () => llamadas.push('usuario.delete') },
    aliadoRepository: { findByDocumentNumber: async () => null, create: async (a) => ({ id: 'aliado-1', ...a }), deleteByUsuarioId: async () => llamadas.push('aliado.delete') },
    aliadoCategoriaRepository: { create: async (ac) => ac, deleteByAliadoId: async () => llamadas.push('categoria.delete') },
    documentoKycRepository: { createMany: async (t, a, d) => d, deleteByAliadoId: async () => llamadas.push('kyc.delete') },
    fileStorageService,
    authIdentityService: {
      createUser: async () => ({ userId: 'user-1' }),
      authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
      deleteUser: async () => llamadas.push('auth.delete'),
    },
  });

  await assert.rejects(
    useCase.execute({
      tenantSlug: 'trama-demo', fullName: 'Maria Fernanda Rojas', email: 'maria@mani.test', password: 'Cambiar123!', phone: '+573001234567',
      categoriaId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18', documentos: docs, acceptsTerms: true,
    }),
    (e) => e.statusCode === 503
  );

  assert.equal(interno.files.size, 0, 'el primer archivo subido se borró: no quedan archivos huérfanos');
  assert.ok(llamadas.includes('auth.delete') && llamadas.includes('usuario.delete') && llamadas.includes('aliado.delete'), 'se compensó la identidad y las filas');
});
