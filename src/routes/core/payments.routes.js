const { Router } = require('express');
const paymentsController = require('../../controllers/payments.controller');
const { authenticate, requireRole } = require('../../middlewares/auth.middleware');

// Dominio Pagos (M-11).
const router = Router();

// HU-M11-01 (SCRUM-1432): pago en el sandbox simulado. Solo el cliente que paga ve sus pagos y comprobantes.
router.post('/pagos', authenticate, paymentsController.createPayment);
// SCRUM-894 y SCRUM-893: rutas fijas antes de `/pagos/:id`, para que `aliado` y `comision` no se lean como un id.
router.get('/pagos/aliado', authenticate, paymentsController.listAllyCollections);
router.get('/pagos/comision', authenticate, requireRole('ADMIN'), paymentsController.getCommission);
router.put('/pagos/comision', authenticate, requireRole('ADMIN'), paymentsController.setCommission);
router.get('/pagos/:id', authenticate, paymentsController.getPayment);
router.get('/pagos/:id/comprobante', authenticate, paymentsController.getReceipt);
// SCRUM-891: retención en garantía del pago, solo para el cliente que pagó.
router.get('/pagos/:id/retencion', authenticate, paymentsController.getRetention);

module.exports = router;
