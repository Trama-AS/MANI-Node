const { Router } = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const auditController = require('../../controllers/audit.controller');

// Registro inmutable de transacciones (HU-M11-03 / SCRUM-889). Solo lectura.
const router = Router();

router.get('/pagos/:id/eventos', authenticate, auditController.listPaymentEvents);
router.get('/auditoria/transacciones', authenticate, auditController.listTransactionEvents);

module.exports = router;
