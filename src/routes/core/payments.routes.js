const { Router } = require('express');
const paymentsController = require('../../controllers/payments.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Pagos (M-11).
const router = Router();

// HU-M11-01 (SCRUM-1432): pago en el sandbox simulado. Solo el cliente que paga ve sus pagos y comprobantes.
router.post('/pagos', authenticate, paymentsController.createPayment);
router.get('/pagos/:id', authenticate, paymentsController.getPayment);
router.get('/pagos/:id/comprobante', authenticate, paymentsController.getReceipt);

module.exports = router;
