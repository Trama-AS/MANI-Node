const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterAllyNaturalPersonUseCase = require('../../../../src/application/useCases/auth/RegisterAllyNaturalPersonUseCase');

const VALID_INPUT = {
  tenantId: 'trama-demo',
  fullName: 'Maria Fernanda Rojas',
  email: 'maria@mani.test',
  password: 'Cambiar123!',
  phone: '+573001234567',
  documentType: 'CC',
  documentNumber: '1020304050',
};

function makeUseCase(overrides = {}) {
  const tenantRepository = { findById: async () => ({ id: 'trama-demo', name: 'Demo', status: 'ACTIVE' }) };
  const usuarioRepository = { findByEmail: async () => null, create: async (u) => u };
  const aliadoRepository = { findByDocumentNumber: async () => null, create: async (a) => a };
  const authIdentityService = {
    createIdentity: async () => ({
      userId: 'user-1',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresIn: 3600,
    }),
  };

  return new RegisterAllyNaturalPersonUseCase({
    tenantRepository,
    usuarioRepository,
    aliadoRepository,
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

for (const field of ['fullName', 'email', 'password', 'phone', 'documentType', 'documentNumber']) {
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

test('VALIDATION_ERROR cuando falta tenantId (header X-Tenant-Id)', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, tenantId: undefined }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('VALIDATION_ERROR cuando documentType no es CC/CE/PASSPORT', async () => {
  const useCase = makeUseCase();

  await assert.rejects(
    () => useCase.execute({ ...VALID_INPUT, documentType: 'DNI' }),
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
  const useCase = makeUseCase({ tenantRepository: { findById: async () => null } });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'TENANT_NOT_FOUND');
      assert.equal(err.statusCode, 400);
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

test('DOCUMENT_ALREADY_REGISTERED cuando el numero de documento ya existe en el tenant', async () => {
  const useCase = makeUseCase({
    aliadoRepository: { findByDocumentNumber: async () => ({ id: 'otro-aliado' }), create: async (a) => a },
  });

  await assert.rejects(
    () => useCase.execute(VALID_INPUT),
    (err) => {
      assert.equal(err.code, 'DOCUMENT_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('no crea la identidad de autenticación si el email ya existe (evita huérfanos en Auth)', async () => {
  let identityCreated = false;
  const useCase = makeUseCase({
    usuarioRepository: { findByEmail: async () => ({ id: 'otro-user' }), create: async (u) => u },
    authIdentityService: {
      createIdentity: async () => {
        identityCreated = true;
        return { userId: 'x', accessToken: 'a', refreshToken: 'b', expiresIn: 1 };
      },
    },
  });

  await assert.rejects(() => useCase.execute(VALID_INPUT));
  assert.equal(identityCreated, false);
});
