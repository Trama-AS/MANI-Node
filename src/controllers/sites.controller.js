const container = require('../container');

/**
 * Controlador HTTP para Sedes y Reglas Contextuales (RF-09 / SCRUM-853)
 */
async function configureSiteRules(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;
  const tenantId = req.user?.tenantId;
  const siteId = req.params.id;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  const userId = req.user?.userId || req.user?.sub;
  const role = req.user?.role || req.user?.user_role || req.user?.rol;

  const {
    horario,
    permisosRequeridos,
    elementosProteccion,
    instruccionesIngreso,
    requiereAprobacionPrevia,
    contactoAcceso,
  } = req.body ?? {};

  try {
    const { site, reglas } = await container.configureSiteRulesUseCase.execute({
      siteId,
      tenantId,
      userId,
      role,
      reglas: {
        horario,
        permisosRequeridos,
        elementosProteccion,
        instruccionesIngreso,
        requiereAprobacionPrevia,
        contactoAcceso,
      },
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
    next(err);
  }
}

async function getSiteRulesForAlly(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;
  const tenantId = req.user?.tenantId;
  const siteId = req.params.id;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  try {
    const result = await container.getSiteRulesForAllyUseCase.execute({
      siteId,
      tenantId,
    });

    return res.status(200).json({
      correlationId,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

async function validateAllySchedule(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;
  const tenantId = req.user?.tenantId;
  const siteId = req.params.id;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  const { fechaHoraPropuesta, justificacion } = req.body ?? {};

  try {
    const result = await container.validateAllyScheduleUseCase.execute({
      siteId,
      tenantId,
      fechaHoraPropuesta,
      justificacion,
    });

    const statusCode = result.estadoValidacion === 'REQUIERE_JUSTIFICACION' ? 422 : 200;

    return res.status(statusCode).json({
      correlationId,
      ...result,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  configureSiteRules,
  getSiteRulesForAlly,
  validateAllySchedule,
};
