const { Router } = require('express');
const { RegisterCompanyClientWithSitesUseCase } = require('../application/RegisterCompanyClientWithSitesUseCase');
const { AddSiteToCompanyClientUseCase } = require('../application/AddSiteToCompanyClientUseCase');
const { GetCompanyClientSitesUseCase } = require('../application/GetCompanyClientSitesUseCase');
const { PostgresCompanyClientRepository } = require('../infrastructure/PostgresCompanyClientRepository');

const router = Router();

// Inyección de dependencias (DIP)
const repository = new PostgresCompanyClientRepository();
const registerUseCase = new RegisterCompanyClientWithSitesUseCase(repository);
const addSiteUseCase = new AddSiteToCompanyClientUseCase(repository);
const getSitesUseCase = new GetCompanyClientSitesUseCase(repository);

/**
 * POST /api/v1/clients/company
 * POST /api/v1/clients (alias)
 * Registra un cliente empresa con múltiples sitios de servicio asociados (RF-08 / US-02.2.2).
 */
async function handleRegisterCompany(req, res) {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.body?.tenantId;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para registrar un cliente empresa.',
      correlationId,
    });
  }

  const { razonSocial, nit, email, telefono, nombreRepresentante, sitios } = req.body ?? {};

  try {
    const { client, sites, isNew } = await registerUseCase.execute({
      tenantId,
      razonSocial,
      nit,
      email,
      telefono,
      nombreRepresentante,
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
      err.message.includes('inválido') ||
      err.message.includes('requerid') ||
      err.message.includes('debe')
    ) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    console.error(`[ClientsController] Error inesperado - Correlation: ${correlationId}`, err);
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
}

router.post('/company', handleRegisterCompany);
router.post('/', handleRegisterCompany);

/**
 * POST /api/v1/clients/:id/sites
 * Registra un sitio adicional a una empresa existente (RF-08 / RF-09).
 */
router.post('/:id/sites', async (req, res) => {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.body?.tenantId;
  const clienteId = req.params.id;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para registrar un sitio.',
      correlationId,
    });
  }

  const { nombre, direccion, zonaId, reglas } = req.body ?? {};

  try {
    const savedSite = await addSiteUseCase.execute({
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
    if (err.message.includes('requerid') || err.message.includes('inválid')) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    console.error(`[ClientsController] Error agregando sitio - Correlation: ${correlationId}`, err);
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
});

/**
 * GET /api/v1/clients/:id/sites
 * Consulta los sitios registrados de una empresa (RF-08 / RF-09).
 */
router.get('/:id/sites', async (req, res) => {
  const correlationId =
    res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.query?.tenantId;
  const clienteId = req.params.id;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para consultar sitios.',
      correlationId,
    });
  }

  try {
    const { client, sites } = await getSitesUseCase.execute({ clienteId, tenantId });
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
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
});

module.exports = router;
