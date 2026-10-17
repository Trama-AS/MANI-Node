const container = require('../container');

/**
 * POST /api/v1/clients/company
 * Registra una organización cliente con sucursales/sedes iniciales (US-02.2.2 / RF-08).
 * Requiere autenticación JWT obligatoria y extrae el tenant del claim (ADR-0018).
 */
async function registerCompany(req, res, next) {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión inválida: tenant_id no presente en el token',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  // Autorización con lista de roles permitidos (DoD §9.3): solo clientes o administradores del tenant
  const userRole = (req.user?.role || req.user?.user_role || req.user?.rol || '').toUpperCase();
  if (!['CLIENT', 'CLIENTE', 'ADMIN', 'ADMIN_TENANT'].includes(userRole)) {
    return res.status(403).json({
      error: 'Rol no autorizado',
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
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code || 'ERROR',
        correlationId,
      });
    }
    next(err);
  }
}

/**
 * POST /api/v1/clients/:id/sites
 * Registra un sitio adicional a una empresa existente (RF-08 / RF-09).
 */
async function addSite(req, res, next) {
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
  if (!['CLIENT', 'CLIENTE', 'ADMIN', 'ADMIN_TENANT'].includes(userRole)) {
    return res.status(403).json({
      error: 'Rol no autorizado',
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
      message: 'Sitio agregado exitosamente.',
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
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code || 'ERROR',
        correlationId,
      });
    }
    next(err);
  }
}

/**
 * GET /api/v1/clients/:id/sites
 * Consulta los sitios registrados de una empresa (RF-08 / RF-09).
 */
async function getSites(req, res, next) {
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
  if (!['CLIENT', 'CLIENTE', 'ADMIN', 'ADMIN_TENANT'].includes(userRole)) {
    return res.status(403).json({
      error: 'Rol no autorizado',
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
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        code: err.code || 'ERROR',
        correlationId,
      });
    }
    next(err);
  }
}

module.exports = {
  registerCompany,
  addSite,
  getSites,
};
