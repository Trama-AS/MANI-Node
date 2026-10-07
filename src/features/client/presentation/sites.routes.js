const { Router } = require('express');
const { ConfigureSiteRulesUseCase } = require('../application/ConfigureSiteRulesUseCase');
const { GetSiteRulesForAllyUseCase } = require('../application/GetSiteRulesForAllyUseCase');
const { ValidateAllyScheduleUseCase } = require('../application/ValidateAllyScheduleUseCase');
const { PostgresCompanyClientRepository } = require('../infrastructure/PostgresCompanyClientRepository');

const router = Router();

// Inyección de dependencias (DIP)
const repository = new PostgresCompanyClientRepository();
const configureRulesUseCase = new ConfigureSiteRulesUseCase(repository);
const getRulesForAllyUseCase = new GetSiteRulesForAllyUseCase(repository);
const validateScheduleUseCase = new ValidateAllyScheduleUseCase(repository);

/**
 * PATCH /api/v1/sites/:id/rules
 * PUT   /api/v1/sites/:id/rules
 * Configura o actualiza las reglas contextuales de una sede (RF-09 / US-02.2.3).
 */
async function handleConfigureRules(req, res) {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.body?.tenantId;
  const siteId = req.params.id;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para configurar reglas del sitio.',
      correlationId,
    });
  }

  const {
    horario,
    permisosRequeridos,
    elementosProteccion,
    instruccionesIngreso,
    requiereAprobacionPrevia,
    contactoAcceso,
  } = req.body ?? {};

  try {
    const { site, reglas } = await configureRulesUseCase.execute({
      siteId,
      tenantId,
      reglas: {
        horario,
        permisosRequeridos,
        elementosProteccion,
        instruccionesIngreso,
        requiereAprobacionPrevia,
        contactoAcceso,
      },
      correlationId,
    });

    return res.status(200).json({
      message: 'Reglas contextuales del sitio configuradas exitosamente.',
      correlationId,
      sitioId: site.id,
      nombreSitio: site.nombre,
      reglas: reglas.toJSON(),
      vistaAliado: reglas.toAllyHighlightedView(),
    });
  } catch (err) {
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ error: err.message, correlationId });
    }
    if (err.message.includes('inválido') || err.message.includes('requerid') || err.message.includes('menor')) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    console.error(`[SitesController] Error configurando reglas - Correlation: ${correlationId}`, err);
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
}

router.patch('/:id/rules', handleConfigureRules);
router.put('/:id/rules', handleConfigureRules);
router.patch('/:id/reglas', handleConfigureRules);
router.put('/:id/reglas', handleConfigureRules);

/**
 * GET /api/v1/sites/:id/rules
 * GET /api/v1/sites/:id/reglas
 * Expone las reglas contextuales del sitio al aliado antes de agendar o aceptar (Scenario 1 & QS-06).
 */
async function handleGetRulesForAlly(req, res) {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.query?.tenantId;
  const siteId = req.params.id;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para consultar reglas del sitio.',
      correlationId,
    });
  }

  try {
    const result = await getRulesForAllyUseCase.execute({
      siteId,
      tenantId,
      correlationId,
    });

    return res.status(200).json({
      correlationId,
      ...result,
    });
  } catch (err) {
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ error: err.message, correlationId });
    }
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
}

router.get('/:id/rules', handleGetRulesForAlly);
router.get('/:id/reglas', handleGetRulesForAlly);

/**
 * POST /api/v1/sites/:id/validate-schedule
 * Valida si un agendamiento propuesto por el aliado cumple con el horario permitido
 * o si genera una advertencia requiriendo justificación (Scenario 2).
 */
router.post('/:id/validate-schedule', async (req, res) => {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.body?.tenantId;
  const siteId = req.params.id;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para validar agenda contra reglas.',
      correlationId,
    });
  }

  const { fechaHoraPropuesta, justificacion } = req.body ?? {};

  if (!fechaHoraPropuesta) {
    return res.status(400).json({
      error: 'fechaHoraPropuesta es requerida en formato ISO 8601.',
      correlationId,
    });
  }

  try {
    const result = await validateScheduleUseCase.execute({
      siteId,
      tenantId,
      fechaHoraPropuesta,
      justificacion,
      correlationId,
    });

    const statusCode = result.estadoValidacion === 'REQUIERE_JUSTIFICACION' ? 422 : 200;

    return res.status(statusCode).json({
      correlationId,
      ...result,
    });
  } catch (err) {
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ error: err.message, correlationId });
    }
    if (err.message.includes('inválida')) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
});

module.exports = router;
