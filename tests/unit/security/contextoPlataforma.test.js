const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContextoPlataformaService,
  tienePermisoPlataforma,
} = require('../../../src/application/security/contextoPlataforma');
const { requireRole } = require('../../../src/middlewares/auth.middleware');
const { dominio } = require('../../../src/application/useCases/sesionDeDominio');

const T1 = '10000000-0000-4000-8000-000000000011';
const T2 = '10000000-0000-4000-8000-000000000021';
const PLATAFORMA = '30000000-0000-4000-8000-000000000099';
const CLIENTE_T2 = '30000000-0000-4000-8000-000000000022';
const ALIADO_T2 = '30000000-0000-4000-8000-000000000023';
const ADMIN_T2 = '30000000-0000-4000-8000-000000000021';
const OTRO_PLATAFORMA = '30000000-0000-4000-8000-000000000098';

const plataforma = { tenantId: T1, userId: PLATAFORMA, role: 'PLATFORM_ADMIN' };
const adminT1 = { tenantId: T1, userId: '30000000-0000-4000-8000-000000000011', role: 'ADMIN' };

const usuariosT2 = {
  [CLIENTE_T2]: { id: CLIENTE_T2, email: 'cliente.t2@qa.mani.test', rol: 'CLIENTE', estado: 'ACTIVO' },
  [ALIADO_T2]: { id: ALIADO_T2, email: 'aliado.t2@qa.mani.test', rol: 'ALIADO', estado: 'ACTIVO' },
  [ADMIN_T2]: { id: ADMIN_T2, email: 'admin.t2@qa.mani.test', rol: 'ADMIN_TENANT', estado: 'ACTIVO' },
  [OTRO_PLATAFORMA]: { id: OTRO_PLATAFORMA, email: 'otro@qa', rol: 'ADMIN_PLATAFORMA', estado: 'ACTIVO' },
};

function servicio() {
  const registros = [];
  const repositorio = {
    obtenerTenant: async (id) => ([T1, T2].includes(id) ? { id, nombre: 'x', slug: 'x', estado: 'ACTIVE' } : null),
    // Como la RLS: solo encuentra usuarios del tenant pedido.
    obtenerUsuario: async (tenantId, id) => (tenantId === T2 ? usuariosT2[id] || null : null),
  };
  const logger = { info: (linea) => registros.push(JSON.parse(linea)) };
  return { svc: new ContextoPlataformaService({ repositorio, logger }), registros };
}

test('SCRUM-901: sin cabeceras, el admin de plataforma administra su propio tenant', async () => {
  const { svc, registros } = servicio();
  const s = await svc.resolver(plataforma, {});
  assert.equal(s.tenantId, T1);
  assert.equal(s.userId, PLATAFORMA);
  assert.equal(s.role, 'ADMIN');
  assert.equal(s.permisoPlataforma, true);
  assert.deepEqual(s.actor, { userId: PLATAFORMA, tenantId: T1, role: 'PLATFORM_ADMIN' });
  assert.equal(registros.length, 0);
});

test('SCRUM-901: con X-Mani-Tenant administra el tenant elegido y queda auditado', async () => {
  const { svc, registros } = servicio();
  const s = await svc.resolver(plataforma, { 'x-mani-tenant': T2 }, { correlationId: 'c-1', metodo: 'GET', ruta: '/quejas' });
  assert.equal(s.tenantId, T2);
  assert.equal(s.role, 'ADMIN');
  assert.equal(registros[0].actor, PLATAFORMA);
  assert.equal(registros[0].tenantEfectivo, T2);
  assert.equal(registros[0].correlationId, 'c-1');
});

test('SCRUM-901: actúa como cliente, aliado o admin de un tenant con su identidad', async () => {
  const { svc, registros } = servicio();
  const comoCliente = await svc.resolver(plataforma, { 'x-mani-tenant': T2, 'x-mani-actuar-como': CLIENTE_T2 });
  assert.deepEqual([comoCliente.tenantId, comoCliente.userId, comoCliente.role], [T2, CLIENTE_T2, 'CLIENT']);
  assert.equal(comoCliente.actor.userId, PLATAFORMA);

  const comoAliado = await svc.resolver(plataforma, { 'x-mani-tenant': T2, 'x-mani-actuar-como': ALIADO_T2 });
  assert.equal(comoAliado.role, 'ALLY');
  const comoAdmin = await svc.resolver(plataforma, { 'x-mani-tenant': T2, 'x-mani-actuar-como': ADMIN_T2 });
  assert.equal(comoAdmin.role, 'ADMIN');
  assert.equal(registros.at(-1).usuarioEfectivo, ADMIN_T2);
});

test('SCRUM-901: rechaza tenant inexistente, usuario de otro tenant, ids inválidos y otro admin de plataforma', async () => {
  const { svc } = servicio();
  await assert.rejects(svc.resolver(plataforma, { 'x-mani-tenant': '10000000-0000-4000-8000-000000000999' }), {
    code: 'MANI-PLA-404',
  });
  // El cliente de T2 no existe en T1 (tenant por omisión).
  await assert.rejects(svc.resolver(plataforma, { 'x-mani-actuar-como': CLIENTE_T2 }), { code: 'MANI-PLA-404' });
  await assert.rejects(svc.resolver(plataforma, { 'x-mani-tenant': 'abc' }), { code: 'MANI-PLA-400' });
  await assert.rejects(svc.resolver(plataforma, { 'x-mani-tenant': T2, 'x-mani-actuar-como': 'abc' }), {
    code: 'MANI-PLA-400',
  });
  await assert.rejects(svc.resolver(plataforma, { 'x-mani-tenant': T2, 'x-mani-actuar-como': OTRO_PLATAFORMA }), {
    code: 'MANI-PLA-403',
  });
});

test('SCRUM-901 (C3): ningún otro rol puede usar las cabeceras', async () => {
  const { svc } = servicio();
  for (const headers of [{ 'x-mani-tenant': T2 }, { 'x-mani-actuar-como': CLIENTE_T2 }]) {
    await assert.rejects(svc.resolver(adminT1, headers), { code: 'MANI-PLA-403', statusCode: 403 });
  }
  // Sin cabeceras la sesión de los demás roles no cambia.
  assert.equal(await svc.resolver(adminT1, {}), adminT1);
});

test('SCRUM-901: sin base de datos las cabeceras responden 503 y sin ellas no se consulta nada', async () => {
  const svc = new ContextoPlataformaService({ repositorio: null });
  await assert.rejects(svc.resolver(plataforma, { 'x-mani-tenant': T2 }), { statusCode: 503 });
  assert.equal((await svc.resolver(plataforma, {})).role, 'ADMIN');
});

function correrRequireRole(user, ...roles) {
  let estado = 200;
  let siguio = false;
  const res = { status: (s) => ((estado = s), { json: () => {} }) };
  requireRole(...roles)({ user, correlationId: 'c' }, res, () => (siguio = true));
  return siguio ? 200 : estado;
}

test('SCRUM-901: las rutas de plataforma siguen abiertas al permiso aunque actúe como otro rol', async () => {
  const { svc } = servicio();
  const comoCliente = await svc.resolver(plataforma, { 'x-mani-tenant': T2, 'x-mani-actuar-como': CLIENTE_T2 });
  assert.equal(tienePermisoPlataforma(comoCliente), true);
  assert.equal(correrRequireRole(comoCliente, 'PLATFORM_ADMIN'), 200);
  assert.equal(correrRequireRole(comoCliente, 'CLIENT'), 200);
  assert.equal(correrRequireRole(comoCliente, 'ADMIN'), 403);
  // El admin de tenant nunca pasa por plataforma.
  assert.equal(correrRequireRole(adminT1, 'PLATFORM_ADMIN'), 403);
  assert.equal(tienePermisoPlataforma(adminT1), false);

  const { sesion } = dominio('MANI-TEN');
  const ctx = sesion(comoCliente, ['PLATFORM_ADMIN'], 'solo plataforma');
  assert.deepEqual(ctx, { tenantId: T2, userId: PLATAFORMA, role: 'PLATFORM_ADMIN' });
  assert.throws(() => sesion(adminT1, ['PLATFORM_ADMIN'], 'solo plataforma'), { code: 'MANI-TEN-403' });
});
