// M-12 (SCRUM-895, 896, 900, 901): validación de entrada, rol de la sesión y composición de resultados en los casos de uso, con
// repositorios falsos. La persistencia, RLS y transiciones se prueban contra PostgreSQL en tests/integration/pg.
const test = require('node:test');
const assert = require('node:assert/strict');
const ComplaintsUseCase = require('../../../src/application/useCases/complaints/ComplaintsUseCase');
const OperationalMetricsUseCase = require('../../../src/application/useCases/metrics/OperationalMetricsUseCase');
const TenantStatusUseCase = require('../../../src/application/useCases/tenants/TenantStatusUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const ADMIN = { tenantId: TENANT, userId: USER, role: 'ADMIN' };
const CLIENTE = { tenantId: TENANT, userId: USER, role: 'CLIENT' };
const ALIADO = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const PLATAFORMA = { tenantId: TENANT, userId: USER, role: 'PLATFORM_ADMIN' };

const codigo = (code, status) => (err) => err.code === code && (status === undefined || err.statusCode === status);

function espia(metodos = {}) {
  const llamadas = [];
  const repo = new Proxy(
    {},
    {
      get: (_t, nombre) => async (ctx, datos) => {
        llamadas.push({ nombre, ctx, datos });
        return metodos[nombre] ? metodos[nombre](ctx, datos) : { ok: true };
      },
    }
  );
  return { repo, llamadas };
}


// ---------------------------------------------------------------- SCRUM-895 / 896
test('895 C1/C2: el cliente registra una queja con motivo válido y descripción de 10 a 1000 caracteres', async () => {
  const { repo, llamadas } = espia();
  const uc = new ComplaintsUseCase({ complaintRepository: repo });
  await uc.registrar({ user: CLIENTE, solicitudId: ID, body: { motivo: 'COBRO_INDEBIDO', descripcion: '  Me cobraron dos veces  ' }, correlationId: 'c' });
  assert.deepEqual(llamadas[0].datos, { solicitudId: ID, motivo: 'COBRO_INDEBIDO', descripcion: 'Me cobraron dos veces', correlationId: 'c' });

  for (const body of [{}, { motivo: 'MOLESTO', descripcion: 'Una descripción válida' }, { motivo: 'OTRO', descripcion: 'corta' }, { motivo: 'OTRO', descripcion: 'x'.repeat(1001) }, { motivo: 'OTRO', descripcion: 12345678901 }]) {
    await assert.rejects(() => uc.registrar({ user: CLIENTE, solicitudId: ID, body }), codigo('MANI-QJA-400', 400), JSON.stringify(body));
  }
  await assert.rejects(() => uc.registrar({ user: CLIENTE, solicitudId: 'x', body: { motivo: 'OTRO', descripcion: 'Descripción válida' } }), codigo('MANI-QJA-400', 400));
  assert.equal(llamadas.length, 1);
});

test('895 C3: aliado, administrador y plataforma no presentan quejas; el aliado tampoco las consulta', async () => {
  const { repo, llamadas } = espia();
  const uc = new ComplaintsUseCase({ complaintRepository: repo });
  const body = { motivo: 'OTRO', descripcion: 'Descripción válida' };
  for (const user of [ALIADO, ADMIN, PLATAFORMA]) {
    await assert.rejects(() => uc.registrar({ user, solicitudId: ID, body }), codigo('MANI-QJA-403', 403));
  }
  await assert.rejects(() => uc.mias({ user: ALIADO }), codigo('MANI-QJA-403', 403));
  await assert.rejects(() => uc.detalle({ user: ALIADO, quejaId: ID }), codigo('MANI-QJA-403', 403));
  await assert.rejects(() => uc.listar({ user: CLIENTE }), codigo('MANI-QJA-403', 403));
  assert.equal(llamadas.length, 0);
});

test('896 C1: el administrador cambia el estado; cerrar exige la respuesta al cliente y se pasa la tabla de transiciones', async () => {
  const { repo, llamadas } = espia();
  const uc = new ComplaintsUseCase({ complaintRepository: repo });

  await uc.cambiarEstado({ user: ADMIN, quejaId: ID, body: { estado: 'EN_REVISION' } });
  assert.equal(llamadas[0].datos.nota, null, 'pasar a revisión no exige nota');
  assert.deepEqual(llamadas[0].datos.transicionesValidas, ComplaintsUseCase.TRANSICIONES);

  for (const estado of ['RESUELTA', 'RECHAZADA']) {
    await assert.rejects(() => uc.cambiarEstado({ user: ADMIN, quejaId: ID, body: { estado } }), codigo('MANI-QJA-400', 400));
  }
  await assert.rejects(() => uc.cambiarEstado({ user: ADMIN, quejaId: ID, body: { estado: 'CERRADA', nota: 'Una nota' } }), codigo('MANI-QJA-400', 400));
  await assert.rejects(() => uc.cambiarEstado({ user: CLIENTE, quejaId: ID, body: { estado: 'RESUELTA', nota: 'Resuelta' } }), codigo('MANI-QJA-403', 403));
  await assert.rejects(() => uc.listar({ user: ADMIN, query: { estado: 'CERRADA' } }), codigo('MANI-QJA-400', 400));
  await assert.rejects(() => uc.listar({ user: ADMIN, query: { limite: '0' } }), codigo('MANI-QJA-400', 400));
  assert.equal(llamadas.length, 1);
});

test('896 C2: la tabla de transiciones deja RESUELTA y RECHAZADA como finales', () => {
  assert.deepEqual(ComplaintsUseCase.TRANSICIONES.RESUELTA, []);
  assert.deepEqual(ComplaintsUseCase.TRANSICIONES.RECHAZADA, []);
  assert.equal(ComplaintsUseCase.TRANSICIONES.EN_REVISION.includes('ABIERTA'), false);
});

// ---------------------------------------------------------------- SCRUM-900
test('900 C1/C2: las métricas del periodo se componen con tasas nulas cuando no hay base de cálculo', async () => {
  const ceros = {
    solicitudesCreadas: 0, solicitudesPorEstado: {}, solicitudesFinalizadas: 0, solicitudesCanceladas: 0, aliadosConServicios: 0,
    cotizacionesEmitidas: 0, cotizacionesAceptadas: 0, pagosAprobados: 0, montoAprobado: 0, calificaciones: 0,
    calificacionPromedio: null, quejasRegistradas: 0, quejasAbiertas: 0, quejasCerradas: 0,
  };
  const { repo } = espia({ agregados: () => ceros });
  const r = await new OperationalMetricsUseCase({ metricsRepository: repo }).consultar({ user: ADMIN, query: { desde: '2026-10-01', hasta: '2026-10-31' } });
  assert.equal(r.solicitudes.creadas, 0);
  assert.equal(r.solicitudes.tasaCancelacion, null);
  assert.equal(r.cotizaciones.tasaAceptacion, null);
  assert.equal(r.calificaciones.promedio, null);
  assert.deepEqual(r.periodo, { desde: '2026-10-01', hasta: '2026-10-31', zonaHoraria: 'America/Bogota' });

  const conDatos = espia({ agregados: () => ({ ...ceros, solicitudesCreadas: 4, solicitudesCanceladas: 1, cotizacionesEmitidas: 3, cotizacionesAceptadas: 2 }) });
  const r2 = await new OperationalMetricsUseCase({ metricsRepository: conDatos.repo }).consultar({ user: ADMIN, query: { desde: '2026-10-01', hasta: '2026-10-31' } });
  assert.equal(r2.solicitudes.tasaCancelacion, 0.25);
  assert.equal(r2.cotizaciones.tasaAceptacion, 0.6667);
});

test('900 C3: solo el administrador del tenant consulta métricas y el periodo máximo es de 366 días', async () => {
  const { repo, llamadas } = espia();
  const uc = new OperationalMetricsUseCase({ metricsRepository: repo });
  for (const user of [CLIENTE, ALIADO, PLATAFORMA]) {
    await assert.rejects(() => uc.consultar({ user, query: { desde: '2026-10-01', hasta: '2026-10-31' } }), codigo('MANI-MET-403', 403));
  }
  await assert.rejects(() => uc.consultar({ user: ADMIN, query: { desde: '2025-01-01', hasta: '2026-10-31' } }), codigo('MANI-MET-400', 400));
  assert.equal(llamadas.length, 0);
});

// ---------------------------------------------------------------- SCRUM-901
test('901 C1: el administrador de plataforma suspende un tenant con motivo; el estado se traduce al de la base', async () => {
  const { repo, llamadas } = espia();
  await new TenantStatusUseCase({ tenantStatusRepository: repo }).cambiarEstado({
    user: PLATAFORMA,
    tenantId: ID,
    body: { estado: 'SUSPENDED', motivo: '  Mora en el pago del plan  ' },
    correlationId: 'corr-901',
  });
  assert.deepEqual(llamadas[0].datos, { tenantId: ID, estado: 'SUSPENDIDO', motivo: 'Mora en el pago del plan', correlationId: 'corr-901' });
});

test('901 C2: un admin_tenant, cliente o aliado no cambia el estado ni ve el historial; motivo y estado se validan', async () => {
  const { repo, llamadas } = espia();
  const uc = new TenantStatusUseCase({ tenantStatusRepository: repo });
  for (const user of [ADMIN, CLIENTE, ALIADO]) {
    await assert.rejects(() => uc.cambiarEstado({ user, tenantId: ID, body: { estado: 'SUSPENDED', motivo: 'Motivo suficiente' } }), codigo('MANI-TEN-403', 403));
    await assert.rejects(() => uc.historial({ user, tenantId: ID }), codigo('MANI-TEN-403', 403));
  }
  for (const body of [{ estado: 'BORRADO', motivo: 'Motivo suficiente' }, { estado: 'ACTIVE' }, { estado: 'ACTIVE', motivo: 'corto' }]) {
    await assert.rejects(() => uc.cambiarEstado({ user: PLATAFORMA, tenantId: ID, body }), codigo('MANI-TEN-400', 400), JSON.stringify(body));
  }
  assert.equal(llamadas.length, 0);
});
