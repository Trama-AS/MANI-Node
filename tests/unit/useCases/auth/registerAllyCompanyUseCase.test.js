const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterAllyCompanyUseCase = require('../../../../src/application/useCases/auth/RegisterAllyCompanyUseCase');

const CAMARA_COMERCIO = {
  tipoDocumento: 'CAMARA_COMERCIO',
  filename: 'camara_comercio.pdf',
  contentType: 'application/pdf',
  buffer: Buffer.from('camara-pdf'),
};

const VALID_INPUT = {
  tenantSlug: 'trama-demo',
  razonSocial: 'Soluciones Hidraulicas SAS',
  nit: '900123456-7',
  nombreRepresentante: 'Carlos Alberto Gomez',
  docRepresentante: '80123456',
  email: 'contacto@hidraulicas.test',
  password: 'Cambiar123!',
  phone: '+573001112233',
  categoriaId: 'cat-1',
  documentos: [CAMARA_COMERCIO],
};

function makeUseCase(overrides = {}) {
  const tenantRepository = {
    findBySlug: async (slug) => ({
      id: 'trama-demo',
      slug: slug || 'trama-demo',
      name: 'Demo',
      status: 'ACTIVE',
      isActive: () => true,
    }),
  };
  const catalogRepository = { findById: async () => ({ id: 'cat-1', isActive: () => true }) };
  const usuarioRepository = { findByEmail: async () => null, create: async (u) => u };
  const aliadoRepository = {
    findByDocumentNumber: async () => null,
    create: async (a) => ({ id: 'aliado-emp-1', ...a }),
  };
  const aliadoCategoriaRepository = { create: async (ac) => ac };
  const documentoKycRepository = { createMany: async (t, a, docs) => docs };
  const fileStorageService = { upload: async ({ path }) => ({ path }) };
  const authIdentityService = {
    createUser: async () => ({ userId: 'user-emp-1' }),
    authenticate: async () => ({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }),
  };

  return new RegisterAllyCompanyUseCase({
    tenantRepository,
    catalogRepository,
    usuarioRepository,
    aliadoRepository,
    aliadoCategoriaRepository,
    documentoKycRepository,
    fileStorageService,
    authIdentityService,
    ...overrides,
  });
}

test('CA-1/CA-2/CA-3: registra aliado EMPRESA en estado PENDIENTE y retorna usuario_id, aliado_id, profile y tokens', async () => {
  let createdAliado = null;
  const useCase = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async (a) => {
        createdAliado = a;
        return { id: 'aliado-emp-1', ...a };
      },
    },
  });

  const result = await useCase.execute(VALID_INPUT);

  assert.equal(result.usuario_id, 'user-emp-1');
  assert.equal(result.aliado_id, 'aliado-emp-1');
  assert.equal(result.estado_verificacion, 'PENDIENTE');
  assert.equal(result.profile.role, 'ALLY');
  assert.equal(result.profile.status, 'PENDING');
  assert.equal(result.profile.tenantId, 'trama-demo');
  assert.equal(result.profile.fullName, VALID_INPUT.razonSocial);
  assert.equal(createdAliado.tipo, 'PERSONA_JURIDICA');
  assert.equal(createdAliado.documentType, 'NIT');
  assert.equal(createdAliado.documentNumber, VALID_INPUT.nit);
  assert.equal(createdAliado.estadoVerificacion, 'PENDING');
});

test('CA-2: sube certificado de camara de comercio con ruta {tenantId}/{aliadoId}/{filename}', async () => {
  const uploaded = [];
  const useCase = makeUseCase({
    fileStorageService: {
      upload: async ({ path, buffer }) => {
        uploaded.push({ path, buffer });
        return { path };
      },
    },
  });

  await useCase.execute(VALID_INPUT);

  assert.equal(uploaded.length, 1);
  assert.match(uploaded[0].path, /^trama-demo\/aliado-emp-1\//);
  assert.match(uploaded[0].path, /camara_comercio\.pdf$/);
});

for (const field of ['razonSocial', 'nit', 'nombreRepresentante', 'email', 'password']) {
  test(`CA-4: VALIDATION_ERROR 400 cuando falta ${field}`, async () => {
    const useCase = makeUseCase();
    const input = { ...VALID_INPUT, [field]: undefined };

    await assert.rejects(
      () => useCase.execute(input),
      (err) => {
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });
}

test('CA-4: VALIDATION_ERROR 400 cuando no se adjunta CAMARA_COMERCIO', async () => {
  const useCase = makeUseCase();
  const soloRut = [
    { tipoDocumento: 'RUT_EMPRESA', filename: 'rut.pdf', contentType: 'application/pdf', buffer: Buffer.from('x') },
  ];

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, documentos: soloRut }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /camara_comercio/i);
      return true;
    }
  );
});

test('CA-5/CA-7: COMPANY_ALREADY_REGISTERED 409 cuando el NIT ya existe en el mismo tenant', async () => {
  const useCase = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async () => ({ id: 'otro-aliado-emp' }),
      create: async (a) => ({ id: 'aliado-emp-1', ...a }),
    },
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'COMPANY_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('CA-7: el mismo NIT puede registrarse en un tenant distinto sin conflicto', async () => {
  const existingInTenantA = new Map([['tenant-a:900123456-7', { id: 'aliado-a' }]]);
  const useCase = makeUseCase({
    tenantRepository: {
      findBySlug: async () => ({
        id: 'tenant-b',
        slug: 'tenant-b',
        name: 'Tenant B',
        status: 'ACTIVE',
        isActive: () => true,
      }),
    },
    aliadoRepository: {
      findByDocumentNumber: async (tenantId, nit) => existingInTenantA.get(`${tenantId}:${nit}`) || null,
      create: async (a) => ({ id: 'aliado-b', ...a }),
    },
  });

  const result = await useCase.execute({ ...VALID_INPUT, tenantSlug: 'tenant-b' });
  assert.equal(result.aliado_id, 'aliado-b');
  assert.equal(result.profile.tenantId, 'tenant-b');
});

test('compensa recursos creados si ocurre un fallo a mitad del registro de empresa', async () => {
  const calls = [];
  const storageError = new Error('Storage caído');
  const useCase = makeUseCase({
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => {
        calls.push('usuario.create');
        return u;
      },
      deleteById: async () => {
        calls.push('usuario.deleteById');
      },
    },
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async (a) => {
        calls.push('aliado.create');
        return { id: 'aliado-emp-1', ...a };
      },
      deleteByUsuarioId: async () => {
        calls.push('aliado.deleteByUsuarioId');
      },
    },
    aliadoCategoriaRepository: {
      create: async (ac) => {
        calls.push('aliadoCategoria.create');
        return ac;
      },
      deleteByAliadoId: async () => {
        calls.push('aliadoCategoria.deleteByAliadoId');
      },
    },
    documentoKycRepository: {
      createMany: async () => {
        throw storageError;
      },
      deleteByAliadoId: async () => {},
    },
    fileStorageService: {
      upload: async ({ path }) => {
        calls.push('file.upload');
        return { path };
      },
      delete: async () => {
        calls.push('file.delete');
      },
    },
    authIdentityService: {
      createUser: async () => {
        calls.push('auth.createUser');
        return { userId: 'user-emp-1' };
      },
      authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
      deleteUser: async () => {
        calls.push('auth.deleteUser');
      },
    },
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT), (err) => err === storageError);

  assert.ok(calls.includes('file.delete'));
  assert.ok(calls.includes('aliadoCategoria.deleteByAliadoId'));
  assert.ok(calls.includes('aliado.deleteByUsuarioId'));
  assert.ok(calls.includes('usuario.deleteById'));
  assert.ok(calls.includes('auth.deleteUser'));
});
