const { Router } = require('express');

const router = Router();

// Endpoint de consulta de tenant y estado del core
router.get('/tenants', (req, res) => {
  res.status(200).json({
    message: 'Listado de tenants del sistema',
    data: [
      { id: 'trama-demo', name: 'TRAMA Servicios Demo', status: 'ACTIVE' }
    ]
  });
});

// Endpoint de perfiles (clientes y profesionales)
router.get('/profiles/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const tenantId = req.headers['x-tenant-id'];
  const userRole = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];

  if (!authHeader && !tenantId) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Petición no autenticada: falta token o contexto de tenant',
      correlationId: req.headers['x-correlation-id'] || 'none',
    });
  }

  res.status(200).json({
    message: 'Perfil de usuario autenticado',
    correlationId: req.headers['x-correlation-id'] || 'none',
    profile: {
      id: userId || 'demo-user-1',
      tenantId: tenantId || 'trama-demo',
      role: userRole || 'CLIENT',
      fullName: 'Usuario Autenticado MANI',
      status: 'VERIFIED'
    }
  });
});

// Endpoint de catálogo de servicios
router.get('/catalog', (req, res) => {
  res.status(200).json({
    categories: [
      { id: 'cat-1', name: 'Manicura Tradicional', active: true },
      { id: 'cat-2', name: 'Semipermanente', active: true },
      { id: 'cat-3', name: 'Uñas Acrílicas / Gel', active: true }
    ]
  });
});

module.exports = router;
