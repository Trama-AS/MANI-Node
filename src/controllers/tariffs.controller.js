const container = require('../container');

const correlationOf = (req) => req.correlationId || 'none';

// M-10 (SCRUM-885, SCRUM-886, SCRUM-887). Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function createTariff(req, res, next) {
  try {
    const tarifa = await container.tariffsUseCase.crear({
      user: req.user,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.status(201).json({ tarifa, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function updateTariff(req, res, next) {
  try {
    const tarifa = await container.tariffsUseCase.editar({
      user: req.user,
      tarifaId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.json({ tarifa, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function listTariffs(req, res, next) {
  try {
    const tarifas = await container.tariffsUseCase.listar({ user: req.user, query: req.query });
    res.set('Cache-Control', 'no-store').json({ tarifas, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getTariffHistory(req, res, next) {
  try {
    const versiones = await container.tariffsUseCase.historial({ user: req.user, categoriaId: req.params.categoriaId });
    res.set('Cache-Control', 'no-store').json({ versiones, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getRequestReferenceTariff(req, res, next) {
  try {
    const referencia = await container.tariffsUseCase.referenciaDeSolicitud({ user: req.user, solicitudId: req.params.id });
    res.set('Cache-Control', 'no-store').json({ ...referencia, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

async function getOutOfRangeQuotesReport(req, res, next) {
  try {
    const reporte = await container.tariffsUseCase.reporteFueraDeRango({
      user: req.user,
      query: req.query,
      correlationId: req.correlationId || null,
    });
    res.set('Cache-Control', 'no-store').json({ ...reporte, correlationId: correlationOf(req) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createTariff,
  updateTariff,
  listTariffs,
  getTariffHistory,
  getRequestReferenceTariff,
  getOutOfRangeQuotesReport,
};
