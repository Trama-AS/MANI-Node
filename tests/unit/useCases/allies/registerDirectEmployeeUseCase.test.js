const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterDirectEmployeeUseCase = require('../../../../src/application/useCases/allies/RegisterDirectEmployeeUseCase');

const PDF = Buffer.from('%PDF-1.4\n%contenido de prueba');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

function makeUseCase(overrides = {}) {
  const calls = { upload: [], deleteFile: [], deleteUser: [], registrar: [], audit: [] };
  const deps = {
    tenantRepository: {
      findById: async (id) => ({ id, slug: 'trama-demo', status: 'ACTIVE', isActive: () => true }),
    },
    catalogRepository: {
      findById: async (_t, id) => (id === 'cat-inactiva' ? { id, isActive: () => false } : { id, isActive: () => true }),
    },
    usuarioRepository: { findByEmail: async () => null },
    aliadoRepository: { findByDocumentNumber: async () => null },
    directEmployeeRepository: {
      registrar: async (ctx, datos) => {
        calls.registrar.push({ ctx, datos });
        return { aliadoId: 'ally-123', documentoId: 'doc-1' };
      },
    },
    fileStorageService: {
      upload: async (p) => {
        calls.upload.push(p);
        return { path: p.path };
      },
      delete: async (path) => calls.deleteFile.push(path),
    },
    authIdentityService: {
      createUser: async ({ email }) => ({ userId: `auth-user-${email}` }),
      deleteUser: async (id) => calls.deleteUser.push(id),
    },
    auditLogger: (entry) => calls.audit.push(entry),
    now: () => new Date('2026-10-28T10:00:00.000Z'),
    ...overrides,
  };
  return { useCase: new RegisterDirectEmployeeUseCase(deps), calls };
}

function entrada(extra = {}) {
  return {
    tenantId: 'tenant-1',
    adminUserId: 'admin-1',
    correlationId: 'corr-1',
    fullName: 'Carlos Alberto Perez',
    email: 'carlos.perez@empresa.com',
    phone: '+573001234567',
    documentType: 'CC',
    documentNumber: '1020304050',
    categoriaIds: ['cat-1', 'cat-2'],
    documento: { buffer: PDF, mimetype: 'application/pdf', originalname: 'cedula.pdf' },
    ...extra,
  };
}

test('registra al empleado: VERIFICADO, con documento en Storage, categorías y auditoría T10', async () => {
  const { useCase, calls } = makeUseCase();
  const result = await useCase.execute(entrada());

  assert.equal(result.employee.tipoAliado, 'EMPLEADO_DIRECTO');
  assert.equal(result.employee.estadoVerificacion, 'VERIFICADO');
  assert.equal(result.employee.status, 'VERIFIED');
  assert.deepEqual(result.employee.categoriaIds, ['cat-1', 'cat-2']);
  assert.equal(result.employee.documento.id, 'doc-1');
  assert.ok(result.temporaryPassword.length >= 8);

  assert.equal(calls.upload.length, 1);
  assert.match(calls.upload[0].path, /^tenant-1\/auth-user-carlos\.perez@empresa\.com\/identidad\//);
  assert.equal(calls.upload[0].contentType, 'application/pdf');
  const { ctx, datos } = calls.registrar[0];
  assert.deepEqual(ctx, { tenantId: 'tenant-1', userId: 'admin-1', role: 'ADMIN' });
  assert.equal(datos.documentNumber, '1020304050');
  assert.equal(datos.documento.rutaStorage, calls.upload[0].path);

  assert.equal(calls.audit.length, 1);
  assert.deepEqual(calls.audit[0], {
    event: 'US-02.1.5.registrar_empleado_directo',
    tenant_id: 'tenant-1',
    empleado_id: 'ally-123',
    decision: 'REGISTRAR',
    estado_resultante: 'VERIFICADO',
    categorias: 2,
    realizado_por: 'admin-1',
    fecha: '2026-10-28T10:00:00.000Z',
    correlation_id: 'corr-1',
  });
  assert.ok(!JSON.stringify(calls.audit[0]).includes('carlos'), 'la auditoría no lleva PII');
});

test('acepta JPG y PNG y respeta el password dado', async () => {
  for (const [buffer, mimetype] of [[JPG, 'image/jpeg'], [PNG, 'image/png']]) {
    const { useCase } = makeUseCase();
    const result = await useCase.execute(entrada({ password: 'ClaveSegura1!', documento: { buffer, mimetype, originalname: 'x' } }));
    assert.equal(result.temporaryPassword, undefined);
    assert.equal(result.employee.documento.contentType, mimetype);
  }
});

test('el documento es obligatorio: sin archivo → DOCUMENT_REQUIRED y no crea nada', async () => {
  const { useCase, calls } = makeUseCase();
  await assert.rejects(() => useCase.execute(entrada({ documento: null })), { code: 'DOCUMENT_REQUIRED', statusCode: 400 });
  assert.equal(calls.registrar.length, 0);
  assert.equal(calls.upload.length, 0);
});

test('rechaza tipos no permitidos (RUT/Cámara en otro formato, GIF, texto)', async () => {
  const { useCase } = makeUseCase();
  for (const mimetype of ['image/gif', 'text/plain', 'application/zip']) {
    await assert.rejects(
      () => useCase.execute(entrada({ documento: { buffer: PDF, mimetype, originalname: 'x' } })),
      { code: 'DOCUMENT_TYPE_INVALID' }
    );
  }
});

test('rechaza un archivo cuyo contenido no corresponde al tipo declarado', async () => {
  const { useCase } = makeUseCase();
  await assert.rejects(
    () => useCase.execute(entrada({ documento: { buffer: Buffer.from('no soy un pdf'), mimetype: 'application/pdf', originalname: 'x.pdf' } })),
    { code: 'DOCUMENT_TYPE_INVALID' }
  );
});

test('5 MB exactos pasan; 5 MB + 1 byte → DOCUMENT_TOO_LARGE 413', async () => {
  const MAX = 5 * 1024 * 1024;
  const grande = (n) => Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(n - 5)]);
  const ok = makeUseCase();
  await ok.useCase.execute(entrada({ documento: { buffer: grande(MAX), mimetype: 'application/pdf', originalname: 'a.pdf' } }));

  const { useCase, calls } = makeUseCase();
  await assert.rejects(
    () => useCase.execute(entrada({ documento: { buffer: grande(MAX + 1), mimetype: 'application/pdf', originalname: 'a.pdf' } })),
    { code: 'DOCUMENT_TOO_LARGE', statusCode: 413 }
  );
  assert.equal(calls.upload.length, 0);
});

for (const [campo, valor] of [
  ['tenantId', undefined],
  ['fullName', 'A'],
  ['email', 'no-es-email'],
  ['password', 'corta'],
  ['phone', undefined],
  ['phone', 'abc'],
  ['documentType', undefined],
  ['documentType', 'NIT'],
  ['documentNumber', undefined],
  ['documentNumber', '   '],
  ['categoriaIds', []],
  ['categoriaIds', undefined],
]) {
  test(`VALIDATION_ERROR si ${campo} es ${JSON.stringify(valor)}`, async () => {
    const { useCase, calls } = makeUseCase();
    await assert.rejects(() => useCase.execute(entrada({ [campo]: valor })), { code: 'VALIDATION_ERROR', statusCode: 400 });
    assert.equal(calls.registrar.length, 0);
  });
}

test('TENANT_NOT_FOUND si el tenant no existe o está inactivo', async () => {
  const sinTenant = makeUseCase({ tenantRepository: { findById: async () => null } });
  await assert.rejects(() => sinTenant.useCase.execute(entrada()), { code: 'TENANT_NOT_FOUND' });
  const inactivo = makeUseCase({ tenantRepository: { findById: async () => ({ isActive: () => false }) } });
  await assert.rejects(() => inactivo.useCase.execute(entrada()), { code: 'TENANT_NOT_FOUND' });
});

test('CATEGORY_NOT_FOUND si alguna categoría no existe, está inactiva o es de otro tenant', async () => {
  const inactiva = makeUseCase();
  await assert.rejects(() => inactiva.useCase.execute(entrada({ categoriaIds: ['cat-1', 'cat-inactiva'] })), { code: 'CATEGORY_NOT_FOUND' });
  const ajena = makeUseCase({ catalogRepository: { findById: async (tenantId, id) => (tenantId === 'tenant-1' ? null : { id, isActive: () => true }) } });
  await assert.rejects(() => ajena.useCase.execute(entrada()), { code: 'CATEGORY_NOT_FOUND' });
  assert.equal(ajena.calls.registrar.length, 0);
});

test('C2: email repetido → 409 EMAIL_ALREADY_REGISTERED', async () => {
  const { useCase } = makeUseCase({ usuarioRepository: { findByEmail: async () => ({ id: 'u' }) } });
  await assert.rejects(() => useCase.execute(entrada()), { code: 'EMAIL_ALREADY_REGISTERED', statusCode: 409 });
});

test('C2: documento de identidad repetido en el tenant → 409 DOCUMENT_ALREADY_REGISTERED, sin subir archivo', async () => {
  let consultado;
  const { useCase, calls } = makeUseCase({
    aliadoRepository: {
      findByDocumentNumber: async (tenantId, numero) => {
        consultado = [tenantId, numero];
        return { id: 'otro' };
      },
    },
  });
  await assert.rejects(() => useCase.execute(entrada()), { code: 'DOCUMENT_ALREADY_REGISTERED', statusCode: 409 });
  assert.deepEqual(consultado, ['tenant-1', '1020304050']);
  assert.equal(calls.upload.length, 0);
});

test('B3: si falla la persistencia, borra el archivo y la identidad y NO audita', async () => {
  const { useCase, calls } = makeUseCase({
    directEmployeeRepository: { registrar: async () => { throw new Error('boom'); } },
  });
  await assert.rejects(() => useCase.execute(entrada()), /boom/);
  assert.equal(calls.deleteFile.length, 1);
  assert.equal(calls.deleteFile[0], calls.upload[0].path);
  assert.deepEqual(calls.deleteUser, ['auth-user-carlos.perez@empresa.com']);
  assert.equal(calls.audit.length, 0);
});

test('B3: si falla la subida, borra la identidad y no persiste', async () => {
  const { useCase, calls } = makeUseCase({
    fileStorageService: { upload: async () => { throw new Error('storage caído'); }, delete: async () => {} },
  });
  await assert.rejects(() => useCase.execute(entrada()), /storage caído/);
  assert.equal(calls.deleteUser.length, 1);
  assert.equal(calls.registrar.length, 0);
});
