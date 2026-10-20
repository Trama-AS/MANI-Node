const test = require('node:test');
const assert = require('node:assert/strict');

const ListAlliesVerificationUseCase = require('../../../../src/application/useCases/verification/ListAlliesVerificationUseCase');
const GetAllyVerificationDetailUseCase = require('../../../../src/application/useCases/verification/GetAllyVerificationDetailUseCase');
const GetKycDocumentSignedUrlUseCase = require('../../../../src/application/useCases/verification/GetKycDocumentSignedUrlUseCase');
const ResolveAllyVerificationUseCase = require('../../../../src/application/useCases/verification/ResolveAllyVerificationUseCase');
const InMemoryAliadoRepository = require('../../../../src/infrastructure/repositories/InMemoryAliadoRepository');
const InMemoryUsuarioRepository = require('../../../../src/infrastructure/repositories/InMemoryUsuarioRepository');
const InMemoryAliadoCategoriaRepository = require('../../../../src/infrastructure/repositories/InMemoryAliadoCategoriaRepository');
const InMemoryCatalogRepository = require('../../../../src/infrastructure/repositories/InMemoryCatalogRepository');
const InMemoryDocumentoKycRepository = require('../../../../src/infrastructure/repositories/InMemoryDocumentoKycRepository');
const InMemoryFileStorageService = require('../../../../src/infrastructure/security/InMemoryFileStorageService');

function makeFixture() {
  const aliadoRepository = new InMemoryAliadoRepository();
  aliadoRepository.aliados.clear();

  const usuarioRepository = new InMemoryUsuarioRepository();
  const aliadoCategoriaRepository = new InMemoryAliadoCategoriaRepository();
  aliadoCategoriaRepository.rows = [];
  const catalogRepository = new InMemoryCatalogRepository();
  const documentoKycRepository = new InMemoryDocumentoKycRepository();
  const fileStorageService = new InMemoryFileStorageService();
  const auditLogs = [];

  const listUseCase = new ListAlliesVerificationUseCase({
    aliadoRepository,
    usuarioRepository,
    aliadoCategoriaRepository,
    catalogRepository,
    documentoKycRepository,
  });

  const detailUseCase = new GetAllyVerificationDetailUseCase({
    aliadoRepository,
    usuarioRepository,
    aliadoCategoriaRepository,
    catalogRepository,
    documentoKycRepository,
  });

  const signedUrlUseCase = new GetKycDocumentSignedUrlUseCase({
    aliadoRepository,
    documentoKycRepository,
    fileStorageService,
  });

  const resolveUseCase = new ResolveAllyVerificationUseCase({
    aliadoRepository,
    usuarioRepository,
    aliadoCategoriaRepository,
    catalogRepository,
    documentoKycRepository,
    auditLogger: (entry) => auditLogs.push(entry),
  });

  return {
    aliadoRepository,
    usuarioRepository,
    aliadoCategoriaRepository,
    documentoKycRepository,
    fileStorageService,
    auditLogs,
    listUseCase,
    detailUseCase,
    signedUrlUseCase,
    resolveUseCase,
  };
}

async function seedPendingAlly(fixture, {
  tenantId = 'tenant-a',
  usuarioId = 'u-carlos',
  aliadoId = 'a-carlos',
  nombre = 'Carlos Mendoza',
  email = 'carlos@mani.test',
  tipo = 'PERSONA_NATURAL',
  fechaRegistro = '2026-10-10T10:00:00.000Z',
  withDocs = true,
} = {}) {
  await fixture.usuarioRepository.create({
    id: usuarioId,
    tenantId,
    email,
    rol: 'ALLY',
    estado: 'ACTIVE',
  });

  await fixture.aliadoRepository.create({
    id: aliadoId,
    usuarioId,
    tenantId,
    tipo,
    nombreRazonSocial: nombre,
    estadoVerificacion: 'PENDING',
    fechaRegistro,
  });

  await fixture.aliadoCategoriaRepository.create({
    tenantId,
    aliadoId,
    categoriaId: 'cat-1',
  });

  if (withDocs) {
    await fixture.documentoKycRepository.createMany(tenantId, aliadoId, [
      {
        id: `doc-ced-${aliadoId}`,
        tipoDocumento: 'CEDULA_CIUDADANIA',
        rutaStorage: `${tenantId}/${aliadoId}/cedula.pdf`,
      },
    ]);
  }
}

test('CA-1/CA-7: lista únicamente aliados del tenant del admin en orden FIFO (excluye otros tenants)', async () => {
  const f = makeFixture();
  await seedPendingAlly(f, {
    tenantId: 'tenant-a',
    usuarioId: 'u-2',
    aliadoId: 'a-2',
    nombre: 'Tecnisur SAS',
    fechaRegistro: '2026-10-15T10:00:00.000Z',
  });
  await seedPendingAlly(f, {
    tenantId: 'tenant-a',
    usuarioId: 'u-1',
    aliadoId: 'a-1',
    nombre: 'Carlos Mendoza',
    fechaRegistro: '2026-10-10T10:00:00.000Z',
  });
  await seedPendingAlly(f, {
    tenantId: 'tenant-b',
    usuarioId: 'u-intruso',
    aliadoId: 'a-intruso',
    nombre: 'Intruso Otro Tenant',
    fechaRegistro: '2026-10-01T10:00:00.000Z',
  });

  const items = await f.listUseCase.execute({
    userId: 'admin-a',
    tenantId: 'tenant-a',
    role: 'ADMIN_TENANT',
  });

  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((x) => x.nombre),
    ['Carlos Mendoza', 'Tecnisur SAS']
  );
  assert.equal(items[0].documentos.length, 1);
});

test('CA-6: deniega por defecto (403 MANI-VER-403) cuando no se envía rol o el rol es ALLY/CLIENT', async () => {
  const f = makeFixture();

  for (const invalidRole of [undefined, null, '', 'ALLY', 'CLIENT']) {
    await assert.rejects(
      () => f.listUseCase.execute({ userId: 'u-1', tenantId: 'tenant-a', role: invalidRole }),
      (err) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'MANI-VER-403');
        return true;
      }
    );
  }
});

test('CA-2/CA-7: genera URL firmada temporal para documento del propio tenant y rechaza 404 para otro tenant', async () => {
  const f = makeFixture();
  await seedPendingAlly(f, { tenantId: 'tenant-a', aliadoId: 'a-carlos' });
  await seedPendingAlly(f, { tenantId: 'tenant-b', usuarioId: 'u-b', aliadoId: 'a-b' });

  const signed = await f.signedUrlUseCase.execute({
    userId: 'admin-a',
    tenantId: 'tenant-a',
    role: 'ADMIN',
    aliadoId: 'a-carlos',
    documentoId: 'doc-ced-a-carlos',
  });

  assert.match(signed.signedUrl, /tenant-a\/a-carlos\/cedula\.pdf/);
  assert.match(signed.signedUrl, /token=/);

  // Intento cross-tenant por aliadoId de otro tenant -> 404
  await assert.rejects(
    () =>
      f.signedUrlUseCase.execute({
        userId: 'admin-a',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        aliadoId: 'a-b',
        documentoId: 'doc-ced-a-b',
      }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'MANI-VER-404');
      return true;
    }
  );

  // Intento cross-tenant enviando rutaStorage directa de otro tenant -> 404
  await assert.rejects(
    () =>
      f.signedUrlUseCase.execute({
        userId: 'admin-a',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        rutaStorage: 'tenant-b/a-b/cedula.pdf',
      }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'MANI-VER-404');
      return true;
    }
  );
});

test('CA-3/CA-5: aprobar aliado pendiente pasa aliado y documentos a VERIFICADO y registra auditoría RNF-04', async () => {
  const f = makeFixture();
  await seedPendingAlly(f, { tenantId: 'tenant-a', aliadoId: 'a-carlos' });

  const resolved = await f.resolveUseCase.execute({
    userId: 'admin-a',
    tenantId: 'tenant-a',
    role: 'ADMIN_TENANT',
    aliadoId: 'a-carlos',
    decision: 'VERIFICADO',
    correlationId: 'corr-123',
  });

  assert.equal(resolved.estado_verificacion, 'VERIFICADO');
  assert.ok(resolved.fecha_verificacion);
  assert.equal(resolved.documentos[0].estado, 'VERIFICADO');
  assert.equal(f.auditLogs.length, 1);
  assert.equal(f.auditLogs[0].event, 'US-02.1.3.resolver_verificacion');
  assert.equal(f.auditLogs[0].tenant_id, 'tenant-a');
  assert.equal(f.auditLogs[0].aliado_id, 'a-carlos');
  assert.equal(f.auditLogs[0].verificado_por, 'admin-a');
  assert.equal(f.auditLogs[0].decision, 'VERIFICADO');
  assert.equal(f.auditLogs[0].correlation_id, 'corr-123');
});

test('CA-4: rechazar exige motivo entre 10 y 500 caracteres (422 MANI-VER-422M) y guarda el motivo', async () => {
  const f = makeFixture();
  await seedPendingAlly(f, { tenantId: 'tenant-a', aliadoId: 'a-carlos' });

  await assert.rejects(
    () =>
      f.resolveUseCase.execute({
        userId: 'admin-a',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        aliadoId: 'a-carlos',
        decision: 'RECHAZADO',
        motivo: 'corto',
      }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, 'MANI-VER-422M');
      return true;
    }
  );

  const motivo = 'La cámara de comercio tiene más de 90 días de expedición.';
  const rejected = await f.resolveUseCase.execute({
    userId: 'admin-a',
    tenantId: 'tenant-a',
    role: 'ADMIN',
    aliadoId: 'a-carlos',
    decision: 'RECHAZADO',
    motivo,
    correlationId: 'corr-456',
  });

  assert.equal(rejected.estado_verificacion, 'RECHAZADO');
  assert.equal(rejected.motivo_rechazo, motivo);
  assert.equal(rejected.documentos[0].estado, 'RECHAZADO');
});

test('bloquea segunda decisión concurrente con 409 MANI-VER-409 y no permite aprobar sin documentos (422 MANI-VER-422K)', async () => {
  const f = makeFixture();
  await seedPendingAlly(f, { tenantId: 'tenant-a', aliadoId: 'a-carlos' });
  await seedPendingAlly(f, {
    tenantId: 'tenant-a',
    usuarioId: 'u-sindoc',
    aliadoId: 'a-sindoc',
    withDocs: false,
  });

  await f.resolveUseCase.execute({
    userId: 'admin-a',
    tenantId: 'tenant-a',
    role: 'ADMIN',
    aliadoId: 'a-carlos',
    decision: 'VERIFICADO',
  });

  await assert.rejects(
    () =>
      f.resolveUseCase.execute({
        userId: 'admin-2',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        aliadoId: 'a-carlos',
        decision: 'RECHAZADO',
        motivo: 'Intento tardío de otro administrador.',
      }),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'MANI-VER-409');
      return true;
    }
  );

  await assert.rejects(
    () =>
      f.resolveUseCase.execute({
        userId: 'admin-a',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        aliadoId: 'a-sindoc',
        decision: 'VERIFICADO',
      }),
    (err) => {
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, 'MANI-VER-422K');
      return true;
    }
  );
});

test('CA-7: un admin de tenant-a no puede ver detalle ni aprobar/rechazar un aliado de tenant-b (404 MANI-VER-404)', async () => {
  const f = makeFixture();
  await seedPendingAlly(f, { tenantId: 'tenant-b', usuarioId: 'u-b', aliadoId: 'a-b' });

  await assert.rejects(
    () =>
      f.detailUseCase.execute({
        userId: 'admin-a',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        aliadoId: 'a-b',
      }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'MANI-VER-404');
      return true;
    }
  );

  await assert.rejects(
    () =>
      f.resolveUseCase.execute({
        userId: 'admin-a',
        tenantId: 'tenant-a',
        role: 'ADMIN',
        aliadoId: 'a-b',
        decision: 'VERIFICADO',
      }),
    (err) => {
      assert.equal(err.statusCode, 404);
      assert.equal(err.code, 'MANI-VER-404');
      return true;
    }
  );

  const unchanged = await f.aliadoRepository.findById('tenant-b', 'a-b');
  assert.equal(unchanged.estadoVerificacion, 'PENDING');
});
