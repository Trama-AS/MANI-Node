const { Router } = require('express');
const quotesController = require('../../controllers/quotes.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Cotización (M-06).
const router = Router();

// US-04.2.1 (SCRUM-865): el aliado asignado cotiza; el cliente dueño y ese aliado consultan las versiones.
router.post('/solicitudes/:id/cotizaciones', authenticate, quotesController.createQuote);
router.get('/solicitudes/:id/cotizaciones', authenticate, quotesController.listQuotes);
// US-04.2.3 (SCRUM-867): el cliente dueño acepta, rechaza o pide ajustar la cotización pendiente.
router.post('/cotizaciones/:id/aceptar', authenticate, quotesController.acceptQuote);
router.post('/cotizaciones/:id/rechazar', authenticate, quotesController.rejectQuote);
router.post('/cotizaciones/:id/ajustar', authenticate, quotesController.adjustQuote);

module.exports = router;
