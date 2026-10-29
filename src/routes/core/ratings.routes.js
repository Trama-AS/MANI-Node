const { Router } = require('express');
const ratingsController = require('../../controllers/ratings.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Calificación, Cierre, Penalización por Cancelación Tardía e Historial (Módulo M-08):
// - SCRUM-874: Cliente califica al aliado
// - SCRUM-875: Aliado califica al cliente
// - SCRUM-1418: Cierre condicionado a la calificación bidireccional
// - SCRUM-876: Calificación agregada visible en el listado
// - SCRUM-878: Penalización por cancelación tardía según política vigente por tenant
// - SCRUM-880: Aliado consulta historial cronológico de trabajos
const router = Router();

// SCRUM-874 / SCRUM-875 / SCRUM-1418: calificaciones bidireccionales y cierre condicionado.
router.post('/solicitudes/:id/calificaciones', authenticate, ratingsController.rateService);
router.get('/solicitudes/:id/calificaciones', authenticate, ratingsController.getServiceRatingsAndClosure);
router.post('/solicitudes/:id/cerrar', authenticate, ratingsController.closeServiceRequest);

// SCRUM-876: calificación agregada visible en el listado de aliados del tenant.
router.get('/aliados/calificaciones', authenticate, ratingsController.listAlliesReputation);
router.get('/aliados/:id/calificacion', authenticate, ratingsController.getAllyReputation);

// SCRUM-878: política de cancelación tardía por tenant y previsualización antes de cancelar.
router.get('/tenants/me/politica-cancelacion', authenticate, ratingsController.getCancellationPolicy);
router.put('/tenants/me/politica-cancelacion', authenticate, ratingsController.configureCancellationPolicy);
router.get('/solicitudes/me/:id/cancelacion-preview', authenticate, ratingsController.previewCancellationPenalty);

// SCRUM-880: historial cronológico de trabajos del aliado asignado.
router.get('/allies/me/history', authenticate, ratingsController.listAllyJobHistory);
router.get('/allies/me/history/:id', authenticate, ratingsController.getAllyJobDetail);
router.get('/allies/me/historial', authenticate, ratingsController.listAllyJobHistory);
router.get('/allies/me/historial/:id', authenticate, ratingsController.getAllyJobDetail);

module.exports = router;
