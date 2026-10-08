const container = require('../container');

/**
 * Controlador HTTP para Documentos Legales y Consentimientos (Habeas Data / Ley 1581 / SCRUM-856)
 */
async function getActiveDocuments(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;

  // ADR-0018: el Gateway propaga X-Tenant-Slug (o query param).
  const tenantSlug = req.headers['x-tenant-slug'] || req.query.tenantSlug || req.query.slug;
  const tenantId = req.user?.tenantId || req.headers['x-tenant-id'];

  try {
    const docs = await container.getActiveLegalDocumentsUseCase.execute({
      tenantSlug,
      tenantId,
    });

    return res.status(200).json({
      correlationId,
      data: docs.map((d) => (d.toJSON ? d.toJSON() : d)),
    });
  } catch (err) {
    next(err);
  }
}

async function registerConsent(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;

  // Seguridad: el usuario y tenant se extraen EXCLUSIVAMENTE de la sesión autenticada (JWT claim)
  const usuarioId = req.user?.userId;
  const tenantId = req.user?.tenantId;

  if (!usuarioId) {
    return res.status(401).json({
      error: 'Sesión inválida: usuario no autenticado',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'] || 'unknown';
  const { documentoLegalIds } = req.body || {};

  try {
    const consents = await container.registerUserConsentUseCase.execute({
      tenantId,
      usuarioId,
      ipAddress,
      userAgent,
      documentoLegalIds,
    });

    return res.status(201).json({
      message: 'Consentimientos registrados con éxito',
      correlationId,
      consents: consents.map((c) => (c.toJSON ? c.toJSON() : c)),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getActiveDocuments,
  registerConsent,
};
