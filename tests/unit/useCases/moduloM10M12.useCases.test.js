// M-10 y M-12: validación de entrada, rol de la sesión y composición de resultados en los casos de uso, con
// repositorios falsos. La persistencia, RLS y transiciones se prueban contra PostgreSQL en tests/integration/pg.
const test = require('node:test');
const assert = require('node:assert/strict');
const TariffsUseCase = require('../../../src/application/useCases/tariffs/TariffsUseCase');
const ComplaintsUseCase = require('../../../src/application/useCases/complaints/ComplaintsUseCase');
const OperationalMetricsUseCase = require('../../../src/application/useCases/metrics/OperationalMetricsUseCase');
const TenantStatusUseCase = require('../../../src/application/useCases/tenants/TenantStatusUseCase');
const { DomainError } = require('../../../src/domain/errors/DomainError');

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

const tarifa = { categoriaId: ID, valorMin: 100000, valorTipico: 150000, valorMax: 200000 };

// ---------------------------------------------------------------- SCRUM-885
test('885 C1: el administrador crea una tarifa; los importes, la moneda y la vigencia llegan normalizados', async () => {
  const { repo, llamadas } = espia();
  const uc = new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} });

  await uc.crear({
    user: ADMIN,
    body: { ...tarifa, valorMin: '100000.50', moneda: 'cop', vigenciaDesde: '2026-11-01', vigenciaHasta: '2026-12-31', condiciones: '  Incluye visita  ' },
    correlationId: 'corr-1',
  });

  assert.deepEqual(llamadas[0].datos, {
    categoriaId: ID,
    valorMin: 100000.5,
    valorTipico: 150000,
    valorMax: 200000,
    moneda: 'COP',
    vigenciaDesde: '2026-11-01',
    vigenciaHasta: '2026-12-31',
    condiciones: 'Incluye visita',
    correlationId: 'corr-1',
  });
  assert.equal(llamadas[0].ctx.tenantId, TENANT, 'el tenant sale de la sesión');
});

test('885 C1: sin vigenciaDesde rige desde hoy en Colombia y sin hasta queda abierta', async () => {
  const { repo, llamadas } = espia();
  await new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} }).crear({ user: ADMIN, body: tarifa });
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  assert.equal(llamadas[0].datos.vigenciaDesde, hoy);
  assert.equal(llamadas[0].datos.vigenciaHasta, null);
  assert.equal(llamadas[0].datos.moneda, 'COP');
});

test('885 C2: valores negativos, invertidos, sin rango, vigencia inválida o categoría mal formada no llegan al repositorio', async () => {
  const { repo, llamadas } = espia();
  const uc = new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} });
  const casos = [
    { ...tarifa, valorMin: -1 },
    { ...tarifa, valorMin: 160000 },
    { ...tarifa, valorTipico: 250000 },
    { ...tarifa, valorMin: 100, valorTipico: 100, valorMax: 100 },
    { ...tarifa, valorMax: '1e9' },
    { ...tarifa, valorMax: 200000.123 },
    { ...tarifa, valorTipico: undefined },
    { ...tarifa, moneda: 'PESOS' },
    { ...tarifa, vigenciaDesde: '2026-02-30' },
    { ...tarifa, vigenciaDesde: '2026-12-01', vigenciaHasta: '2026-11-30' },
    { ...tarifa, condiciones: 'x'.repeat(501) },
    { ...tarifa, categoriaId: 'no-es-uuid' },
  ];
  for (const body of casos) {
    await assert.rejects(() => uc.crear({ user: ADMIN, body }), codigo('MANI-TAR-400', 400), JSON.stringify(body));
  }
  assert.equal(llamadas.length, 0);
});

test('885 C3: cliente, aliado y plataforma no gestionan el tarifario (403) y sin sesión es 401', async () => {
  const { repo, llamadas } = espia();
  const uc = new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} });
  for (const user of [CLIENTE, ALIADO, PLATAFORMA]) {
    await assert.rejects(() => uc.crear({ user, body: tarifa }), codigo('MANI-TAR-403', 403));
    await assert.rejects(() => uc.editar({ user, tarifaId: ID, body: tarifa }), codigo('MANI-TAR-403', 403));
    await assert.rejects(() => uc.listar({ user }), codigo('MANI-TAR-403', 403));
    await assert.rejects(() => uc.historial({ user, categoriaId: ID }), codigo('MANI-TAR-403', 403));
  }
  await assert.rejects(() => uc.crear({ user: null, body: tarifa }), codigo('MANI-TAR-401', 401));
  assert.equal(llamadas.length, 0);
});

test('885: editar crea la versión nueva sobre la tarifa indicada; ADMIN_TENANT se acepta como ADMIN', async () => {
  const { repo, llamadas } = espia();
  await new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} }).editar({
    user: { ...ADMIN, role: 'ADMIN_TENANT' },
    tarifaId: ID,
    body: tarifa,
  });
  assert.equal(llamadas[0].nombre, 'reemplazar');
  assert.equal(llamadas[0].datos.tarifaId, ID);
  assert.equal(llamadas[0].ctx.role, 'ADMIN');
});

// ---------------------------------------------------------------- SCRUM-886
test('886: cliente, aliado y administrador consultan la referencia de una solicitud con la fecha de hoy', async () => {
  for (const user of [CLIENTE, ALIADO, ADMIN]) {
    const { repo, llamadas } = espia({ vigenteParaSolicitud: () => ({ disponible: false, tarifa: null }) });
    const r = await new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} }).referenciaDeSolicitud({ user, solicitudId: ID });
    assert.deepEqual(r, { disponible: false, tarifa: null });
    assert.match(llamadas[0].datos.fecha, /^\d{4}-\d{2}-\d{2}$/);
  }
  const { repo } = espia();
  await assert.rejects(
    () => new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} }).referenciaDeSolicitud({ user: PLATAFORMA, solicitudId: ID }),
    codigo('MANI-TAR-403', 403)
  );
});

// ---------------------------------------------------------------- SCRUM-887
const cot = (id, total, conTarifa = true) => ({
  id,
  total,
  tarifa: conTarifa ? { valorMin: 100, valorTipico: 150, valorMax: 200 } : null,
});

test('887 C1: el reporte envía a Rules solo las cotizaciones con tarifa y devuelve las que Rules marcó fuera de rango', async () => {
  const { repo } = espia({ cotizacionesConTarifa: () => [cot('a', 90), cot('b', 150), cot('c', 300), cot('d', 500, false)] });
  const enviados = [];
  const rules = {
    evaluateRates: async (params) => {
      enviados.push(params);
      return {
        version: 'rates-v1',
        resultados: [
          { id: 'a', resultado: 'POR_DEBAJO', desviacionPorcentaje: 10 },
          { id: 'b', resultado: 'DENTRO_DE_RANGO', desviacionPorcentaje: 0 },
          { id: 'c', resultado: 'POR_ENCIMA', desviacionPorcentaje: 50 },
        ],
      };
    },
  };

  const r = await new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: rules }).reporteFueraDeRango({
    user: ADMIN,
    query: { desde: '2026-10-01', hasta: '2026-10-31' },
    correlationId: 'corr-887',
  });

  assert.deepEqual(enviados[0].items.map((i) => i.id), ['a', 'b', 'c']);
  assert.equal(enviados[0].tenantId, TENANT);
  assert.equal(enviados[0].correlationId, 'corr-887');
  assert.deepEqual(r.totales, { cotizaciones: 4, evaluadas: 3, sinTarifa: 1, fueraDeRango: 2 });
  assert.deepEqual(r.cotizaciones.map((c) => [c.id, c.resultado, c.desviacionPorcentaje]), [
    ['a', 'POR_DEBAJO', 10],
    ['c', 'POR_ENCIMA', 50],
  ]);
  assert.equal(r.reglasVersion, 'rates-v1');
});

test('887 C2: sin cotizaciones con tarifa el reporte es vacío y no llama a Rules; si Rules cae es 503', async () => {
  let llamadas = 0;
  const caido = {
    evaluateRates: async () => {
      llamadas += 1;
      throw new DomainError('El servicio de reglas no está disponible', 'RULES_SERVICE_UNAVAILABLE', 503);
    },
  };
  const vacio = espia({ cotizacionesConTarifa: () => [cot('x', 10, false)] });
  const r = await new TariffsUseCase({ tariffRepository: vacio.repo, ruleEvaluationService: caido }).reporteFueraDeRango({
    user: ADMIN,
    query: { desde: '2026-10-01', hasta: '2026-10-01' },
  });
  assert.deepEqual(r.totales, { cotizaciones: 1, evaluadas: 0, sinTarifa: 1, fueraDeRango: 0 });
  assert.deepEqual(r.cotizaciones, []);
  assert.equal(llamadas, 0);

  const conDatos = espia({ cotizacionesConTarifa: () => [cot('a', 90)] });
  await assert.rejects(
    () => new TariffsUseCase({ tariffRepository: conDatos.repo, ruleEvaluationService: caido }).reporteFueraDeRango({
      user: ADMIN,
      query: { desde: '2026-10-01', hasta: '2026-10-31' },
    }),
    codigo('RULES_SERVICE_UNAVAILABLE', 503)
  );
});

test('887 C3: solo el administrador ve el reporte y el periodo se valida (fechas, orden y 92 días)', async () => {
  const { repo, llamadas } = espia({ cotizacionesConTarifa: () => [] });
  const uc = new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} });
  for (const user of [CLIENTE, ALIADO]) {
    await assert.rejects(() => uc.reporteFueraDeRango({ user, query: { desde: '2026-10-01', hasta: '2026-10-02' } }), codigo('MANI-TAR-403', 403));
  }
  for (const query of [{}, { desde: '2026-10-05', hasta: '2026-10-01' }, { desde: '2026-01-01', hasta: '2026-12-31' }, { desde: '2026-13-01', hasta: '2026-13-02' }]) {
    await assert.rejects(() => uc.reporteFueraDeRango({ user: ADMIN, query }), codigo('MANI-TAR-400', 400), JSON.stringify(query));
  }
  assert.equal(llamadas.length, 0);
});

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
