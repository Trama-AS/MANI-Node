const { Router } = require('express');
const authenticate = require('../middlewares/auth.middleware');
const legalController = require('../controllers/legal.controller');

const router = Router();

// Consulta pública / pre-login de documentos legales activos (resuelve por X-Tenant-Slug según ADR-0018)
router.get('/legal/documents/active', legalController.getActiveDocuments);

// Registro autenticado de consentimientos de usuario (toma usuario y tenant del JWT claim)
router.post('/legal/consents', authenticate, legalController.registerConsent);

module.exports = router;
