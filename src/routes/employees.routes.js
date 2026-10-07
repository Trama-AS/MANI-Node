const { Router } = require('express');
const { authenticate, requireRole } = require('../middlewares/auth.middleware');
const employeesController = require('../controllers/employees.controller');

const router = Router();

// RF-05 / US-02.1.5 / SCRUM-850: Registro de empleado directo por Admin del Tenant
router.post(
  '/allies/employees',
  authenticate,
  requireRole('ADMIN'),
  employeesController.registerDirectEmployee
);

// Alias de administración
router.post(
  '/admin/employees',
  authenticate,
  requireRole('ADMIN'),
  employeesController.registerDirectEmployee
);

module.exports = router;
