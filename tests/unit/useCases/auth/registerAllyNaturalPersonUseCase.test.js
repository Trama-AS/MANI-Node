const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterAllyNaturalPersonUseCase = require('../../../../src/application/useCases/auth/RegisterAllyNaturalPersonUseCase');

const CEDULA = { tipoDocumento: 'CEDULA_CIUDADANIA', filename: 'cedula.pdf', contentType: 'application/pdf', buffer: Buffer.from('x') };

const VALID_INPUT = {
  tenantSlug: 'trama-demo',
  fullName: 'Maria Fernanda Rojas',
  email: 'maria@mani.test',
  password: 'Cambiar123!',
  phone: '+573001234567',
  categoriaId: 'cat-1',
  documentos: [CEDULA],
};

function makeUseCase(overrides = {}) {
  const tenantRepository = {
    findBySlug: async (slug) => ({ id: 'trama-demo', slug: slug || 'trama-demo', name: 'Demo', status: 'ACTIVE', isActive: () => true }),
  };
  const catalogRepository = { findById: async () => ({ id: 'cat-1', isActive: () => true }) };
  const usuarioRepository = { findByEmail: async () => null, create: async (u) => u };
  const aliadoRepository = { findByDocumentNumber: async () => null, create: async (a) => ({ id: 'aliado-1', ...a }) };
  const aliadoCategoriaRepository = { create: async (ac) => ac };
  const documentoKycRepository = { createMany: async (t, a, docs) => docs };
  const fileStorageService = { upload: async ({ path }) => ({ path }) };
  const authIdentityService = {
    createUser: async () => ({ userId: 'user-1' }),
    authenticate: async () => ({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 }),
  };

  return new RegisterAllyNaturalPersonUseCase({
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

test('registra un aliado y retorna profile ALLY/PENDING + tokens', async () => {
  const useCase = makeUseCase();

  const result = await useCase.execute(VALID_INPUT);

  assert.equal(result.profile.role, 'ALLY');
  assert.equal(result.profile.status, 'PENDING');
  assert.equal(result.profile.tenantId, 'trama-demo');
  assert.equal(result.profile.fullName, VALID_INPUT.fullName);
  assert.deepEqual(result.tokens, { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
});

test('sube cada documento KYC con la ruta {tenantId}/{userId}/... antes de autenticar', async () => {
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
  assert.match(uploaded[0].path, /^trama-demo\/user-1\//);
});

for (const field of ['fullName', 'email', 'password', 'categoriaId']) {
  test(`VALIDATION_ERROR cuando falta ${field}`, async () => {
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

test('VALIDATION_ERROR cuando falta tenantSlug (header X-Tenant-Slug)', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, tenantSlug: undefined }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('VALIDATION_ERROR cuando no hay documentos KYC', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, documentos: [] }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('VALIDATION_ERROR cuando el email tiene formato inválido', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, email: 'no-es-un-email' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('VALIDATION_ERROR cuando el password tiene menos de 8 caracteres', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, password: 'short' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('TENANT_NOT_FOUND cuando el tenant no existe', async () => {
  const useCase = makeUseCase({ tenantRepository: { findBySlug: async () => null } });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'TENANT_NOT_FOUND');
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('TENANT_NOT_FOUND cuando el tenant está inactivo', async () => {
  const useCase = makeUseCase({
    tenantRepository: {
      findBySlug: async () => ({ id: 'trama-demo', name: 'Demo', status: 'INACTIVE', isActive: () => false }),
    },
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'TENANT_NOT_FOUND');
      assert.equal(err.statusCode, 400);
      return true;
    }
  );
});

test('CATEGORY_NOT_FOUND cuando la categoría no existe o está inactiva', async () => {
  const useCase = makeUseCase({ catalogRepository: { findById: async () => null } });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NOT_FOUND');
      return true;
    }
  );
});

test('EMAIL_ALREADY_REGISTERED cuando el email ya existe en el tenant', async () => {
  const useCase = makeUseCase({
    usuarioRepository: { findByEmail: async () => ({ id: 'otro-user' }), create: async (u) => u },
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'EMAIL_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('DOCUMENT_ALREADY_REGISTERED cuando se envía documentNumber y ya existe en el tenant', async () => {
  const useCase = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async () => ({ id: 'otro-aliado' }),
      create: async (a) => ({ id: 'aliado-1', ...a }),
    },
  });

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, documentNumber: '123' }),
    (err) => {
      assert.equal(err.code, 'DOCUMENT_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('no valida documentNumber duplicado si no se envía (Flutter no lo manda)', async () => {
  let called = false;
  const useCase = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async () => {
        called = true;
        return null;
      },
      create: async (a) => ({ id: 'aliado-1', ...a }),
    },
  });

  await useCase.execute(VALID_INPUT);
  assert.equal(called, false);
});

test('no crea la identidad de autenticación si el email ya existe (evita huérfanos en Auth)', async () => {
  let identityCreated = false;
  const useCase = makeUseCase({
    usuarioRepository: { findByEmail: async () => ({ id: 'otro-user' }), create: async (u) => u },
    authIdentityService: {
      createUser: async () => {
        identityCreated = true;
        return { userId: 'x' };
      },
      authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
    },
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT));
  assert.equal(identityCreated, false);
});

test('authenticate() se llama después de crear usuario/aliado (orden correcto para el hook de claims)', async () => {
  const calls = [];
  const useCase = makeUseCase({
    usuarioRepository: { findByEmail: async () => null, create: async (u) => { calls.push('usuario'); return u; } },
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async (a) => { calls.push('aliado'); return { id: 'aliado-1', ...a }; },
    },
    authIdentityService: {
      createUser: async () => { calls.push('createUser'); return { userId: 'user-1' }; },
      authenticate: async () => { calls.push('authenticate'); return { accessToken: 'a', refreshToken: 'b', expiresIn: 1 }; },
    },
  });

  await useCase.execute(VALID_INPUT);

  assert.deepEqual(calls, ['createUser', 'usuario', 'aliado', 'authenticate']);
});
