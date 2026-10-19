const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterDirectEmployeeUseCase = require('../../../../src/application/useCases/allies/RegisterDirectEmployeeUseCase');
const { ValidationError, ConflictError } = require('../../../../src/domain/errors/DomainError');

function makeUseCase(overrides = {}) {
  const tenantRepository = {
    findById: async (id) => ({
      id,
      slug: 'trama-demo',
      name: 'Tenant Demo',
      status: 'ACTIVE',
      isActive: () => true,
    }),
  };
  const catalogRepository = {
    findById: async (_tId, id) => ({ id, name: 'Plomería', isActive: () => true }),
  };
  const usuarioRepository = {
    findByEmail: async () => null,
    create: async (u) => ({ ...u }),
    deleteById: async () => {},
  };
  const aliadoRepository = {
    findByDocumentNumber: async () => null,
    create: async (a) => ({ id: 'ally-123', ...a }),
    deleteByUsuarioId: async () => {},
  };
  const aliadoCategoriaRepository = {
    create: async (ac) => ({ ...ac }),
    deleteByAliadoId: async () => {},
  };
  const authIdentityService = {
    createUser: async ({ email }) => ({ userId: `auth-user-${email}` }),
    deleteUser: async () => {},
  };

  return new RegisterDirectEmployeeUseCase({
    tenantRepository,
    catalogRepository,
    usuarioRepository,
    aliadoRepository,
    aliadoCategoriaRepository,
    authIdentityService,
    ...overrides,
  });
}

test('registra un empleado directo exitosamente sin documentos KYC y queda VERIFICADO', async () => {
  const useCase = makeUseCase();

  const result = await useCase.execute({
    tenantId: 'tenant-1',
    fullName: 'Carlos Alberto Perez',
    email: 'carlos.perez@empresa.com',
    phone: '+573001234567',
    documentType: 'CC',
    documentNumber: '1020304050',
  });

  assert.ok(result.employee);
  assert.equal(result.employee.fullName, 'Carlos Alberto Perez');
  assert.equal(result.employee.email, 'carlos.perez@empresa.com');
  assert.equal(result.employee.tipoAliado, 'EMPLEADO_DIRECTO');
  assert.equal(result.employee.estadoVerificacion, 'VERIFICADO');
  assert.equal(result.employee.status, 'VERIFIED');
  assert.ok(result.temporaryPassword);
  assert.ok(result.temporaryPassword.length >= 8);
});

test('acepta atributos en español (nombre, telefono, numeroDocumento) transparentemente', async () => {
  const useCase = makeUseCase();

  const result = await useCase.execute({
    tenantId: 'tenant-1',
    nombre: 'Laura Ramirez',
    email: 'laura@empresa.com',
    telefono: '+573119876543',
    tipoDocumento: 'CE',
    numeroDocumento: '987654',
  });

  assert.equal(result.employee.fullName, 'Laura Ramirez');
  assert.equal(result.employee.nombre, 'Laura Ramirez');
  assert.equal(result.employee.telefono, '+573119876543');
  assert.equal(result.employee.documentType, 'CE');
  assert.equal(result.employee.documentNumber, '987654');
});

test('respeta el password proporcionado por el administrador y no retorna temporaryPassword', async () => {
  const useCase = makeUseCase();

  const result = await useCase.execute({
    tenantId: 'tenant-1',
    fullName: 'Javier Gomez',
    email: 'javier@empresa.com',
    password: 'PasswordSeguro123!',
  });

  assert.equal(result.temporaryPassword, undefined);
});

test('asocia categoria si se proporciona categoriaId activa', async () => {
  let categoriaAsociada = null;
  const useCase = makeUseCase({
    aliadoCategoriaRepository: {
      create: async (ac) => {
        categoriaAsociada = ac;
        return ac;
      },
    },
  });

  const result = await useCase.execute({
    tenantId: 'tenant-1',
    fullName: 'Pedro Almodovar',
    email: 'pedro@empresa.com',
    categoriaId: 'cat-electricidad',
  });

  assert.equal(result.employee.categoriaId, 'cat-electricidad');
  assert.ok(categoriaAsociada);
  assert.equal(categoriaAsociada.categoriaId, 'cat-electricidad');
});

test('VALIDATION_ERROR si falta tenantId', async () => {
  const useCase = makeUseCase();
  await assert.rejects(
    () => useCase.execute({ fullName: 'Pedro', email: 'p@m.com' }),
    (err) => err instanceof ValidationError && err.message.includes('tenantId')
  );
});

test('VALIDATION_ERROR si falta fullName o nombre', async () => {
  const useCase = makeUseCase();
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', email: 'p@m.com' }),
    (err) => err instanceof ValidationError && err.code === 'VALIDATION_ERROR'
  );
});

test('VALIDATION_ERROR si email tiene formato inválido', async () => {
  const useCase = makeUseCase();
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'email-invalido' }),
    (err) => err instanceof ValidationError && err.code === 'VALIDATION_ERROR'
  );
});

test('VALIDATION_ERROR si password tiene menos de 8 caracteres', async () => {
  const useCase = makeUseCase();
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com', password: '123' }),
    (err) => err instanceof ValidationError && err.code === 'VALIDATION_ERROR'
  );
});

test('VALIDATION_ERROR si documentType no es permitido', async () => {
  const useCase = makeUseCase();
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com', documentType: 'DNI_INVALIDO' }),
    (err) => err instanceof ValidationError && err.code === 'VALIDATION_ERROR'
  );
});

test('TENANT_NOT_FOUND si el tenant no existe', async () => {
  const useCase = makeUseCase({
    tenantRepository: { findById: async () => null },
  });
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-inexistente', fullName: 'Pedro', email: 'p@m.com' }),
    (err) => err instanceof ValidationError && err.code === 'TENANT_NOT_FOUND'
  );
});

test('TENANT_NOT_FOUND si el tenant está inactivo', async () => {
  const useCase = makeUseCase({
    tenantRepository: {
      findById: async (id) => ({ id, isActive: () => false }),
    },
  });
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com' }),
    (err) => err instanceof ValidationError && err.code === 'TENANT_NOT_FOUND'
  );
});

test('CATEGORY_NOT_FOUND si la categoría no existe o está inactiva', async () => {
  const useCase = makeUseCase({
    catalogRepository: { findById: async () => null },
  });
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com', categoriaId: 'cat-inactiva' }),
    (err) => err instanceof ValidationError && err.code === 'CATEGORY_NOT_FOUND'
  );
});

test('CATEGORY_NOT_FOUND si la categoría pertenece a otro tenant (filtra por tenant del token)', async () => {
  let queriedTenantId = null;
  const useCase = makeUseCase({
    catalogRepository: {
      findById: async (tId, catId) => {
        queriedTenantId = tId;
        if (tId !== 'tenant-autorizado') return null;
        return { id: catId, name: 'Categoría X', isActive: () => true };
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({
      tenantId: 'tenant-intruso',
      fullName: 'Carlos',
      email: 'carlos@empresa.com',
      categoriaId: 'cat-otro-tenant',
    }),
    (err) => err instanceof ValidationError && err.code === 'CATEGORY_NOT_FOUND'
  );
  assert.equal(queriedTenantId, 'tenant-intruso');
});

test('EMAIL_ALREADY_REGISTERED si el email ya existe en el tenant', async () => {
  const useCase = makeUseCase({
    usuarioRepository: {
      findByEmail: async () => ({ id: 'u-existente', email: 'existente@m.com' }),
    },
  });
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'existente@m.com' }),
    (err) => err instanceof ConflictError && err.code === 'EMAIL_ALREADY_REGISTERED'
  );
});

test('DOCUMENT_ALREADY_REGISTERED si el documento ya existe en el tenant', async () => {
  const useCase = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async () => ({ id: 'a-existente', numeroDocumento: '12345' }),
    },
  });
  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com', documentNumber: '12345' }),
    (err) => err instanceof ConflictError && err.code === 'DOCUMENT_ALREADY_REGISTERED'
  );
});

test('Compensación (SAGA / B3): si falla creación de aliado, compensa usuario y auth identity', async () => {
  let authDeleted = false;
  let usuarioDeleted = false;

  const useCase = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async () => {
        throw new Error('Falla en Postgres insert aliado');
      },
    },
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => u,
      deleteById: async () => {
        usuarioDeleted = true;
      },
    },
    authIdentityService: {
      createUser: async () => ({ userId: 'auth-user-1' }),
      deleteUser: async (uid) => {
        if (uid === 'auth-user-1') authDeleted = true;
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com' }),
    (err) => err.message.includes('Falla en Postgres')
  );

  assert.equal(authDeleted, true, 'Debe compensar borrando el usuario en Auth');
  assert.equal(usuarioDeleted, true, 'Debe compensar borrando la fila de usuario');
});

test('Compensación (SAGA / B3): si falla creación en aliado_categoria, compensa todo', async () => {
  let authDeleted = false;
  let usuarioDeleted = false;
  let aliadoDeleted = false;

  const useCase = makeUseCase({
    aliadoCategoriaRepository: {
      create: async () => {
        throw new Error('Falla en insert aliado_categoria');
      },
      deleteByAliadoId: async () => {},
    },
    aliadoRepository: {
      findByDocumentNumber: async () => null,
      create: async (a) => ({ id: 'ally-1', ...a }),
      deleteByUsuarioId: async () => {
        aliadoDeleted = true;
      },
    },
    usuarioRepository: {
      findByEmail: async () => null,
      create: async (u) => u,
      deleteById: async () => {
        usuarioDeleted = true;
      },
    },
    authIdentityService: {
      createUser: async () => ({ userId: 'auth-user-1' }),
      deleteUser: async () => {
        authDeleted = true;
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't-1', fullName: 'Pedro', email: 'p@m.com', categoriaId: 'cat-1' }),
    (err) => err.message.includes('Falla en insert aliado_categoria')
  );

  assert.equal(aliadoDeleted, true);
  assert.equal(usuarioDeleted, true);
  assert.equal(authDeleted, true);
});
