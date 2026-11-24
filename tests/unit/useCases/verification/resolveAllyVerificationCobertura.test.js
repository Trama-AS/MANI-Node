const test = require('node:test');
const assert = require('node:assert/strict');
const ResolveAllyVerificationUseCase = require('../../../../src/application/useCases/verification/ResolveAllyVerificationUseCase');

// SCRUM-1727 (QAS-23): cubre las ramas de "aprobar aliado" que las pruebas de bandeja no ejercitan: sinónimos de decisión,
// sesión y rol, aliado inexistente o ya resuelto, aprobación sin KYC y la carrera entre dos administradores.

const TENANT = '11111111-1111-4111-8111-111111111111';
const ADMIN = { userId: 'aaaa1111-1111-4111-8111-111111111111', tenantId: TENANT, role: 'ADMIN_TENANT' };
const MOTIVO = 'Documentos ilegibles, vuelve a cargarlos';

function armar({ aliado = { id: 'al-1', usuario_id: 'u-1', estado_verificacion: 'PENDIENTE' }, documentos = [{ id: 'd-1', tipo_documento: 'CEDULA', estado: 'PENDIENTE' }], actualizado } = {}) {
  const llamadas = { actualizar: [], kyc: [], auditoria: [] };
  const aliadoRepository = {
    findById: async () => aliado,
    updateVerificationStatus: async (...args) => {
      llamadas.actualizar.push(args);
      return actualizado === undefined ? { ...aliado, estado_verificacion: args[2].estadoVerificacion } : actualizado;
    },
  };
  const documentoKycRepository = {
    findByAliadoId: async () => documentos,
    updateStatusByAliadoId: async (...args) => llamadas.kyc.push(args),
  };
  const useCase = new ResolveAllyVerificationUseCase({
    aliadoRepository,
    usuarioRepository: { findById: async () => ({ id: 'u-1', email: 'ana@t.test' }) },
    aliadoCategoriaRepository: { findByAliadoId: async () => [] },
    catalogRepository: { findCategoryById: async () => null, findCategoriasByIds: async () => [] },
    documentoKycRepository,
    auditLogger: (e) => llamadas.auditoria.push(e),
  });
  return { useCase, llamadas };
}

const resolver = (useCase, extra = {}) => useCase.execute({ ...ADMIN, aliadoId: 'al-1', decision: 'VERIFICADO', correlationId: 'corr-1', ...extra });

test('los sinónimos de aprobación (VERIFIED, APROBADO, APPROVED) aprueban', async () => {
  for (const decision of ['VERIFIED', 'aprobado', ' Approved ', 'verificado']) {
    const { useCase, llamadas } = armar();
    await resolver(useCase, { decision });
    assert.equal(llamadas.actualizar[0][2].estadoVerificacion, 'VERIFIED', decision);
    assert.deepEqual(llamadas.kyc[0].slice(2), ['VERIFICADO']);
  }
});

test('los sinónimos de rechazo (REJECTED, rechazado) rechazan con motivo y guardan quién y cuándo', async () => {
  for (const decision of ['REJECTED', 'rechazado']) {
    const { useCase, llamadas } = armar();
    await resolver(useCase, { decision, motivo: `  ${MOTIVO}  ` });
    const cambio = llamadas.actualizar[0][2];
    assert.equal(cambio.estadoVerificacion, 'REJECTED');
    assert.equal(cambio.motivoRechazo, MOTIVO, 'el motivo se guarda sin espacios sobrantes');
    assert.equal(cambio.verificadoPor, ADMIN.userId);
    assert.ok(!Number.isNaN(Date.parse(cambio.fechaVerificacion)));
  }
});

test('aprobar no guarda motivo de rechazo aunque venga uno', async () => {
  const { useCase, llamadas } = armar();
  await resolver(useCase, { motivo: MOTIVO });
  assert.equal(llamadas.actualizar[0][2].motivoRechazo, null);
});

test('una decisión desconocida o vacía es 422 MANI-VER-422D y no toca nada', async () => {
  for (const decision of ['TAL VEZ', '', undefined, null]) {
    const { useCase, llamadas } = armar();
    await assert.rejects(() => resolver(useCase, { decision }), (err) => err.code === 'MANI-VER-422D' && err.statusCode === 422);
    assert.equal(llamadas.actualizar.length, 0);
  }
});

test('rechazar exige motivo de 10 a 500 caracteres', async () => {
  for (const motivo of [undefined, '', '   corto  ', 'x'.repeat(501), 42]) {
    const { useCase, llamadas } = armar();
    await assert.rejects(() => resolver(useCase, { decision: 'RECHAZADO', motivo }), (err) => err.code === 'MANI-VER-422M');
    assert.equal(llamadas.actualizar.length, 0);
  }
  const { useCase } = armar();
  await assert.doesNotReject(() => resolver(useCase, { decision: 'RECHAZADO', motivo: 'x'.repeat(10) }));
  await assert.doesNotReject(() => resolver(armar().useCase, { decision: 'RECHAZADO', motivo: 'x'.repeat(500) }));
});

test('sin sesión es 401 y con un rol que no es administrador es 403', async () => {
  const { useCase } = armar();
  await assert.rejects(() => resolver(useCase, { userId: undefined }), (err) => err.statusCode === 401);
  await assert.rejects(() => resolver(useCase, { tenantId: undefined }), (err) => err.statusCode === 401);
  for (const role of ['CLIENT', 'ALLY', undefined, '']) {
    await assert.rejects(() => resolver(useCase, { role }), (err) => err.statusCode === 403, String(role));
  }
});

test('el rol se acepta sin importar mayúsculas ni espacios', async () => {
  const { useCase } = armar();
  await assert.doesNotReject(() => resolver(useCase, { role: ' admin ' }));
});

test('un aliado sin id, o que no existe en el tenant, es 404', async () => {
  const { useCase } = armar();
  await assert.rejects(() => resolver(useCase, { aliadoId: undefined }), (err) => err.code === 'MANI-VER-404');

  const { useCase: sinAliado } = armar({ aliado: null });
  await assert.rejects(() => resolver(sinAliado), (err) => err.code === 'MANI-VER-404' && err.statusCode === 404);
});

test('una solicitud ya resuelta es 409, venga el estado en español, en inglés o con camelCase', async () => {
  for (const aliado of [
    { id: 'al-1', estado_verificacion: 'VERIFICADO' },
    { id: 'al-1', estado_verificacion: 'REJECTED' },
    { id: 'al-1', estadoVerificacion: 'verified' },
    { id: 'al-1' },
  ]) {
    const { useCase, llamadas } = armar({ aliado });
    await assert.rejects(() => resolver(useCase), (err) => err.code === 'MANI-VER-409' && err.statusCode === 409);
    assert.equal(llamadas.actualizar.length, 0);
  }
});

test('un aliado pendiente en inglés (PENDING) se puede resolver', async () => {
  const { useCase } = armar({ aliado: { id: 'al-1', estadoVerificacion: 'pending' } });
  await assert.doesNotReject(() => resolver(useCase));
});

test('aprobar sin documentos KYC es 422 MANI-VER-422K; rechazar sin documentos sí se puede', async () => {
  for (const documentos of [[], null]) {
    const { useCase, llamadas } = armar({ documentos });
    await assert.rejects(() => resolver(useCase), (err) => err.code === 'MANI-VER-422K');
    assert.equal(llamadas.actualizar.length, 0);
  }
  const { useCase } = armar({ documentos: [] });
  await assert.doesNotReject(() => resolver(useCase, { decision: 'RECHAZADO', motivo: MOTIVO }));
});

test('si otro administrador resolvió primero (la actualización no devuelve fila) es 409 y no cambia los documentos ni audita', async () => {
  const { useCase, llamadas } = armar({ actualizado: null });
  await assert.rejects(() => resolver(useCase), (err) => err.code === 'MANI-VER-409' && /otro administrador/.test(err.message));
  assert.equal(llamadas.kyc.length, 0);
  assert.equal(llamadas.auditoria.length, 0);
});

test('la auditoría lleva tenant, aliado, administrador, decisión y correlación, y no lleva datos personales', async () => {
  const { useCase, llamadas } = armar();
  await resolver(useCase, { correlationId: 'corr-77' });
  const [evento] = llamadas.auditoria;
  assert.equal(evento.event, 'US-02.1.3.resolver_verificacion');
  assert.equal(evento.tenant_id, TENANT);
  assert.equal(evento.aliado_id, 'al-1');
  assert.equal(evento.verificado_por, ADMIN.userId);
  assert.equal(evento.decision, 'VERIFICADO');
  assert.equal(evento.correlation_id, 'corr-77');
  assert.doesNotMatch(JSON.stringify(evento), /ana@t\.test|motivo/);
});

test('sin correlationId se audita "none"', async () => {
  const { useCase, llamadas } = armar();
  await useCase.execute({ ...ADMIN, aliadoId: 'al-1', decision: 'VERIFICADO' });
  assert.equal(llamadas.auditoria[0].correlation_id, 'none');
});

test('usa el id canónico del aliado que devolvió el repositorio', async () => {
  const { useCase, llamadas } = armar({ aliado: { id: 'canonico-9', estado_verificacion: 'PENDIENTE' } });
  await resolver(useCase, { aliadoId: 'otro-alias' });
  assert.equal(llamadas.actualizar[0][1], 'canonico-9');
  assert.equal(llamadas.kyc[0][1], 'canonico-9');
});
