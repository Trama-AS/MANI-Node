const { Router } = require('express');
const tenantRulesController = require('../../controllers/tenantRules.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

// Dominio Reglas Operativas del Tenant (SCRUM-1366 / HU-M01-03).
const router = Router();

// GET /tenant/rules: Versión vigente (cualquier rol autenticado del tenant)
router.get('/tenant/rules', authenticate, tenantRulesController.getVigente);

// GET /tenant/rules/history: Historial de versiones (solo administradores)
router.get('/tenant/rules/history', authenticate, requireRole('ADMIN', 'ADMIN_PLATAFORMA', 'PLATFORM_ADMIN'), tenantRulesController.getHistorial);

// PUT /tenant/rules: Guarda nueva versión versionada con expectedVersion (solo admin_tenant)
router.put('/tenant/rules', authenticate, requireRole('ADMIN'), tenantRulesController.updateRules);

module.exports = router;
