const container = require('../container');
const { domainRoleToClaim } = require('../infrastructure/security/claimRoleMap');

async function listTenants(req, res, next) {
  try {
    const data = await container.listTenantsUseCase.execute();
    res.status(200).json({
      message: 'Listado de tenants del sistema',
      data,
    });
  } catch (err) {
    next(err);
  }
}

// SCRUM-901 (HU-M12-07). El actor sale de `authenticate`; el motivo, del cuerpo.
async function changeTenantStatus(req, res, next) {
  try {
    const resultado = await container.tenantStatusUseCase.cambiarEstado({
      user: req.user,
      tenantId: req.params.id,
      body: req.body || {},
      correlationId: req.correlationId || null,
    });
    res.json({ ...resultado, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getTenantStatusHistory(req, res, next) {
  try {
    const cambios = await container.tenantStatusUseCase.historial({ user: req.user, tenantId: req.params.id });
    res.set('Cache-Control', 'no-store').json({ cambios, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

// SCRUM-901: usuarios del tenant (id, correo, rol y estado) para el selector «Actuar como».
async function listTenantUsers(req, res, next) {
  try {
    const id = String(req.params.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({
        error: 'MANI-PLA-400: el id del tenant no es un UUID válido',
        code: 'MANI-PLA-400',
        correlationId: req.correlationId || 'none',
      });
    }
    const repo = container.contextoPlataformaRepository;
    if (!repo) {
      return res.status(503).json({
        error: 'MANI-SRV-503: la base de datos no está configurada (DATABASE_URL)',
        code: 'SERVICE_UNAVAILABLE',
        correlationId: req.correlationId || 'none',
      });
    }
    const usuarios = (await repo.listarUsuarios(id))
      // Con otro administrador de plataforma no se actúa.
      .filter((u) => String(u.rol).toUpperCase() !== 'ADMIN_PLATAFORMA')
      .map((u) => ({ id: u.id, email: u.email, rol: u.rol, estado: u.estado }));
    res.set('Cache-Control', 'no-store').json({ usuarios, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function getEffectiveContext(req, res) {
  const u = req.user;
  res.set('Cache-Control', 'no-store').json({
    tenantId: u.tenantId,
    userId: u.userId,
    // Vocabulario del claim (aliado, cliente, admin_tenant, admin_plataforma), el mismo que lee Dispatch.
    role: domainRoleToClaim(String(u.role)),
    permisoPlataforma: Boolean(u.permisoPlataforma),
    actor: u.actor || null,
    correlationId: req.correlationId || 'none',
  });
}

module.exports = { listTenants, changeTenantStatus, getTenantStatusHistory, listTenantUsers, getEffectiveContext };
