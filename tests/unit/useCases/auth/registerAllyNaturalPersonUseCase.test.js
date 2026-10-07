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

// B3: sin compensación, un fallo a mitad del registro deja un usuario de
// auth.users huérfano y filas de usuario/aliado que harían fallar un
// reintento legítimo con 409 aunque el registro nunca se completó.
test('B3: si falla el paso de documento_kyc, compensa (borra) todo lo creado antes y relanza el error original', async () => {
  const calls = [];
  const originalError = new Error('Storage caído');

  const useCase = makeUseCase({
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => { calls.push('usuario.create'); return u; },
      deleteById: async () => { calls.push('usuario.deleteById'); },
    },
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async (a) => { calls.push('aliado.create'); return { id: 'aliado-1', ...a }; },
      deleteByUsuarioId: async () => { calls.push('aliado.deleteByUsuarioId'); },
    },
    aliadoCategoriaRepository: {
      create: async (ac) => { calls.push('aliadoCategoria.create'); return ac; },
      deleteByAliadoId: async () => { calls.push('aliadoCategoria.deleteByAliadoId'); },
    },
    documentoKycRepository: {
      createMany: async () => { calls.push('documentoKyc.createMany'); throw originalError; },
      deleteByAliadoId: async () => { calls.push('documentoKyc.deleteByAliadoId'); },
    },
    fileStorageService: {
      upload: async ({ path }) => { calls.push('file.upload'); return { path }; },
      delete: async () => { calls.push('file.delete'); },
    },
    authIdentityService: {
      createUser: async () => { calls.push('auth.createUser'); return { userId: 'user-1' }; },
      authenticate: async () => { calls.push('auth.authenticate'); return { accessToken: 'a', refreshToken: 'b', expiresIn: 1 }; },
      deleteUser: async () => { calls.push('auth.deleteUser'); },
    },
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT), (err) => err === originalError);

  // No debe haberse autenticado nunca (el fallo ocurrió antes de ese paso).
  assert.ok(!calls.includes('auth.authenticate'));
  // Se compensó todo lo que sí se llegó a crear, incluyendo el archivo subido.
  assert.ok(calls.includes('file.delete'));
  assert.ok(calls.includes('aliadoCategoria.deleteByAliadoId'));
  assert.ok(calls.includes('aliado.deleteByUsuarioId'));
  assert.ok(calls.includes('usuario.deleteById'));
  assert.ok(calls.includes('auth.deleteUser'));
  // documento_kyc nunca llegó a crearse (createMany lanzó), así que no debe compensarse.
  assert.ok(!calls.includes('documentoKyc.deleteByAliadoId'));
});

test('B3: un fallo de compensación individual no bloquea la limpieza del resto (Promise.allSettled)', async () => {
  const calls = [];
  const useCase = makeUseCase({
    aliadoCategoriaRepository: {
      create: async (ac) => ac,
      deleteByAliadoId: async () => { throw new Error('No se pudo borrar aliado_categoria'); },
    },
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async (a) => ({ id: 'aliado-1', ...a }),
      deleteByUsuarioId: async () => { calls.push('aliado.deleteByUsuarioId'); },
    },
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => u,
      deleteById: async () => { calls.push('usuario.deleteById'); },
    },
    documentoKycRepository: {
      createMany: async () => { throw new Error('KYC caído'); },
      deleteByAliadoId: async () => {},
    },
    fileStorageService: {
      upload: async ({ path }) => ({ path }),
      delete: async () => { calls.push('file.delete'); },
    },
    authIdentityService: {
      createUser: async () => ({ userId: 'user-1' }),
      authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
      deleteUser: async () => { calls.push('auth.deleteUser'); },
    },
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT));

  assert.ok(calls.includes('aliado.deleteByUsuarioId'));
  assert.ok(calls.includes('usuario.deleteById'));
  assert.ok(calls.includes('auth.deleteUser'));
});

test('B3: tras una falla compensada, un reintento con los mismos datos se registra limpio (sin 409 falso)', async () => {
  const UsuarioRepoStub = require('../../../../src/infrastructure/repositories/InMemoryUsuarioRepository');
  const AliadoRepoStub = require('../../../../src/infrastructure/repositories/InMemoryAliadoRepository');
  const AliadoCategoriaRepoStub = require('../../../../src/infrastructure/repositories/InMemoryAliadoCategoriaRepository');
  const DocumentoKycRepoStub = require('../../../../src/infrastructure/repositories/InMemoryDocumentoKycRepository');

  const usuarioRepository = new UsuarioRepoStub();
  const aliadoRepository = new AliadoRepoStub();
  const aliadoCategoriaRepository = new AliadoCategoriaRepoStub();
  const documentoKycRepository = new DocumentoKycRepoStub();
  const identities = new Map();

  let failUpload = true;
  const fileStorageService = {
    upload: async ({ path }) => {
      if (failUpload) throw new Error('Storage caído (primer intento)');
      return { path };
    },
    delete: async () => {},
  };
  const authIdentityService = {
    createUser: async ({ email }) => {
      const userId = `user-${identities.size + 1}`;
      identities.set(userId, { email });
      return { userId };
    },
    authenticate: async () => ({ accessToken: 'a', refreshToken: 'b', expiresIn: 1 }),
    deleteUser: async (userId) => { identities.delete(userId); },
  };

  const useCase = makeUseCase({
    usuarioRepository,
    aliadoRepository,
    aliadoCategoriaRepository,
    documentoKycRepository,
    fileStorageService,
    authIdentityService,
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT));

  // El primer intento falló y debió compensarse por completo.
  assert.equal(await usuarioRepository.findByEmail('trama-demo', VALID_INPUT.email), null);
  assert.equal(identities.size, 0);

  failUpload = false;
  const result = await useCase.execute(VALID_INPUT);

  assert.equal(result.profile.role, 'ALLY');
  assert.equal(result.profile.status, 'PENDING');
});
