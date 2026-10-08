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
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  // Autorización por rol dentro del tenant (DoD §9.3): los aliados no pueden registrar empresas
  const userRole = (req.user?.role || req.user?.user_role || req.user?.rol || '').toUpperCase();
  if (userRole === 'ALLY' || userRole === 'ALIADO') {
    return res.status(403).json({
      error: 'Un aliado no tiene permisos para registrar clientes empresa',
      code: 'FORBIDDEN',
      correlationId,
    });
  }

  const { razonSocial, nit, email, telefono, nombreRepresentante, password, sitios } = req.body ?? {};

  try {
    const { client, sites, temporaryPassword, isNew } = await container.registerCompanyClientWithSitesUseCase.execute({
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

    return res.status(201).json({
      message: 'Cliente empresa y sitios registrados exitosamente.',
      correlationId,
      tenantId,
      isNew,
      temporaryPassword,
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
    const status = err.statusCode || (
      err.code === 'VALIDATION_ERROR' ||
      err.message.includes('inválid') ||
      err.message.includes('requerid') ||
      err.message.includes('debe') ? 400 : null
    );

    if (status) {
      return res.status(status).json({
        error: err.message,
        code: err.code || 'ERROR',
        correlationId,
      });
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
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  // Autorización por rol dentro del tenant (DoD §9.3): los aliados no pueden gestionar sedes
  const userRole = (req.user?.role || req.user?.user_role || req.user?.rol || '').toUpperCase();
  const userId = req.user?.userId || req.user?.sub;
  if (userRole === 'ALLY' || userRole === 'ALIADO') {
    return res.status(403).json({
      error: 'Un aliado no tiene permisos para gestionar sedes de clientes empresa',
      code: 'FORBIDDEN',
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
      userId,
      userRole,
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
    const status = err.statusCode || (
      err.message.includes('no encontrado') ? 404 :
      (err.code === 'VALIDATION_ERROR' || err.message.includes('requerid') || err.message.includes('inválid') ? 400 : null)
    );

    if (status) {
      return res.status(status).json({
        error: err.message,
        code: err.code || 'ERROR',
        correlationId,
      });
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
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  const userRole = (req.user?.role || req.user?.user_role || req.user?.rol || '').toUpperCase();
  const userId = req.user?.userId || req.user?.sub;
  if (userRole === 'ALLY' || userRole === 'ALIADO') {
    return res.status(403).json({
      error: 'Un aliado no tiene permisos para consultar sedes de clientes empresa',
      code: 'FORBIDDEN',
      correlationId,
    });
  }

  try {
    const { client, sites } = await container.getCompanyClientSitesUseCase.execute({
      clienteId,
      tenantId,
      userId,
      userRole,
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
    const status = err.statusCode || (err.message.includes('no encontrado') ? 404 : null);
    if (status) {
      return res.status(status).json({
        error: err.message,
        code: err.code || 'ERROR',
        correlationId,
      });
    }
    next(err);
  }
});

module.exports = router;
