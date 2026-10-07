const { Router } = require('express');
const authenticate = require('../../../middlewares/auth.middleware');
const container = require('../../../container');

const router = Router();

// Aplica autenticación obligatoria a todas las operaciones de cliente empresa (ADR-0018)
router.use(authenticate);

/**
 * POST /api/v1/clients/company
 * POST /api/v1/clients (alias)
 * Registra un cliente empresa con múltiples sitios de servicio asociados (RF-08 / US-02.2.2).
 */
async function handleRegisterCompany(req, res, next) {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;

  // ADR-0018: El tenant se extrae EXCLUSIVAMENTE del claim del token JWT verificado
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      correlationId,
    });
  }

  const { razonSocial, nit, email, telefono, nombreRepresentante, password, sitios } = req.body ?? {};

  try {
    const { client, sites, isNew } = await container.registerCompanyClientWithSitesUseCase.execute({
      tenantId,
      razonSocial,
      nit,
      email,
      telefono,
      nombreRepresentante,
      password,
      sitios,
      correlationId,
    });

    const statusCode = isNew ? 201 : 200;
    return res.status(statusCode).json({
      message: isNew
        ? 'Cliente empresa y sitios registrados exitosamente.'
        : 'El cliente empresa ya existe para este tenant. Se retorna el registro y sus sitios.',
      correlationId,
      tenantId,
      isNew,
      client: {
        id: client.id,
        tenantId: client.tenantId,
        razonSocial: client.razonSocial,
        nit: client.nit,
        email: client.email,
        telefono: client.telefono,
        nombreRepresentante: client.nombreRepresentante,
        tipo: client.tipo,
        estado: client.estado,
        creadoEn: client.creadoEn,
      },
      sitios: sites.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        direccion: s.direccion,
        zonaId: s.zonaId,
        reglas: s.reglas,
        creadoEn: s.creadoEn,
      })),
    });
  } catch (err) {
    if (
      err.message.includes('inválid') ||
      err.message.includes('requerid') ||
      err.message.includes('debe') ||
      err.code === 'VALIDATION_ERROR'
    ) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    next(err);
  }
}

router.post('/company', handleRegisterCompany);
router.post('/', handleRegisterCompany);

/**
 * POST /api/v1/clients/:id/sites
 * Registra un sitio adicional a una empresa existente (RF-08 / RF-09).
 */
router.post('/:id/sites', async (req, res, next) => {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.user?.tenantId;
  const clienteId = req.params.id;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      correlationId,
    });
  }

  const { nombre, direccion, zonaId, reglas } = req.body ?? {};

  try {
    const savedSite = await container.addSiteToCompanyClientUseCase.execute({
      clienteId,
      tenantId,
      nombre,
      direccion,
      zonaId,
      reglas,
      correlationId,
    });

    return res.status(201).json({
      message: 'Sitio registrado exitosamente y asociado al cliente empresa.',
      correlationId,
      sitio: {
        id: savedSite.id,
        clienteId: savedSite.clienteId,
        nombre: savedSite.nombre,
        direccion: savedSite.direccion,
        zonaId: savedSite.zonaId,
        reglas: savedSite.reglas,
      },
    });
  } catch (err) {
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ error: err.message, correlationId });
    }
    if (
      err.message.includes('requerid') ||
      err.message.includes('inválid') ||
      err.code === 'VALIDATION_ERROR'
    ) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    next(err);
  }
});

/**
 * GET /api/v1/clients/:id/sites
 * Consulta los sitios registrados de una empresa (RF-08 / RF-09).
 */
router.get('/:id/sites', async (req, res, next) => {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.user?.tenantId;
  const clienteId = req.params.id;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      correlationId,
    });
  }

  try {
    const { client, sites } = await container.getCompanyClientSitesUseCase.execute({
      clienteId,
      tenantId,
    });

    return res.status(200).json({
      correlationId,
      clienteId: client.id,
      razonSocial: client.razonSocial,
      totalSitios: sites.length,
      sitios: sites.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        direccion: s.direccion,
        zonaId: s.zonaId,
        reglas: s.reglas,
      })),
    });
  } catch (err) {
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ error: err.message, correlationId });
    }
    next(err);
  }
});

module.exports = router;
