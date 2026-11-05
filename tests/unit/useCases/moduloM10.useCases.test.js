// M-10 (SCRUM-885, 886, 887): validación de entrada, rol de la sesión y composición de resultados en los casos de uso, con
// repositorios falsos. La persistencia, RLS y transiciones se prueban contra PostgreSQL en tests/integration/pg.
const test = require('node:test');
const assert = require('node:assert/strict');
const TariffsUseCase = require('../../../src/application/useCases/tariffs/TariffsUseCase');
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

// ---------------------------------------------------------------- SCRUM-866
const cotizacion866 = (total, conTarifa = true) => ({
  id: ID,
  solicitudId: ID,
  version: 2,
  total,
  tarifa: conTarifa ? { id: ID, version: 1, valorMin: 100, valorTipico: 150, valorMax: 200, moneda: 'COP' } : null,
});

function rulesQueResponde(resultado, desviacionPorcentaje) {
  const enviados = [];
  return {
    enviados,
    evaluateRates: async (params) => {
      enviados.push(params);
      return { version: 'rates-v1', resultados: params.items.map((i) => ({ id: i.id, resultado, desviacionPorcentaje })) };
    },
  };
}

test('866 C1: fuera de banda (por encima o por debajo) devuelve alerta con la referencia y la desviación', async () => {
  for (const [resultado, total] of [['POR_ENCIMA', 300], ['POR_DEBAJO', 50]]) {
    const { repo } = espia({ cotizacionConTarifa: () => cotizacion866(total) });
    const rules = rulesQueResponde(resultado, 50);
    const r = await new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: rules }).evaluarCotizacion({
      user: CLIENTE,
      cotizacionId: ID,
      correlationId: 'corr-866',
    });
    assert.equal(r.resultado, resultado);
    assert.equal(r.alerta, true);
    assert.equal(r.desviacionPorcentaje, 50);
    assert.equal(r.total, total, 'la cotización no se modifica');
    assert.deepEqual([r.tarifa.valorMin, r.tarifa.valorTipico, r.tarifa.valorMax], [100, 150, 200]);
    assert.equal(r.reglasVersion, 'rates-v1');
    assert.deepEqual(rules.enviados[0].items, [{ id: ID, total, valorMin: 100, valorTipico: 150, valorMax: 200 }]);
    assert.equal(rules.enviados[0].tenantId, TENANT, 'el tenant sale de la sesión');
    assert.equal(rules.enviados[0].correlationId, 'corr-866');
  }
});

test('866 C1: dentro de banda no dispara una alerta falsa', async () => {
  const { repo } = espia({ cotizacionConTarifa: () => cotizacion866(150) });
  const r = await new TariffsUseCase({
    tariffRepository: repo,
    ruleEvaluationService: rulesQueResponde('DENTRO_DE_RANGO', 0),
  }).evaluarCotizacion({ user: ALIADO, cotizacionId: ID });
  assert.equal(r.resultado, 'DENTRO_DE_RANGO');
  assert.equal(r.alerta, false);
});

test('866 C2: sin tarifa responde SIN_TARIFA sin llamar a Rules; si Rules cae el 503 sube sin resultado inventado', async () => {
  let llamadas = 0;
  const caido = {
    evaluateRates: async () => {
      llamadas += 1;
      throw new DomainError('El servicio de reglas no está disponible', 'RULES_SERVICE_UNAVAILABLE', 503);
    },
  };
  const sinTarifa = espia({ cotizacionConTarifa: () => cotizacion866(999, false) });
  const r = await new TariffsUseCase({ tariffRepository: sinTarifa.repo, ruleEvaluationService: caido }).evaluarCotizacion({
    user: CLIENTE,
    cotizacionId: ID,
  });
  assert.deepEqual(
    { resultado: r.resultado, alerta: r.alerta, tarifa: r.tarifa, desviacionPorcentaje: r.desviacionPorcentaje },
    { resultado: 'SIN_TARIFA', alerta: false, tarifa: null, desviacionPorcentaje: null }
  );
  assert.equal(llamadas, 0);

  const conTarifa = espia({ cotizacionConTarifa: () => cotizacion866(300) });
  await assert.rejects(
    () =>
      new TariffsUseCase({ tariffRepository: conTarifa.repo, ruleEvaluationService: caido }).evaluarCotizacion({
        user: CLIENTE,
        cotizacionId: ID,
      }),
    codigo('RULES_SERVICE_UNAVAILABLE', 503)
  );
});

test('866 C3: plataforma recibe 403, sin sesión 401 y un id mal formado 400, sin consultar el repositorio', async () => {
  const { repo, llamadas } = espia();
  const uc = new TariffsUseCase({ tariffRepository: repo, ruleEvaluationService: {} });
  await assert.rejects(() => uc.evaluarCotizacion({ user: PLATAFORMA, cotizacionId: ID }), codigo('MANI-TAR-403', 403));
  await assert.rejects(() => uc.evaluarCotizacion({ user: null, cotizacionId: ID }), (err) => err.statusCode === 401);
  await assert.rejects(() => uc.evaluarCotizacion({ user: CLIENTE, cotizacionId: 'no-uuid' }), codigo('MANI-TAR-400', 400));
  assert.equal(llamadas.length, 0);
});
