const { Router } = require('express');
const dispatchIntegrationController = require('../../controllers/dispatchIntegration.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Superficie que consume MANI-Dispatch (ADR-0030): Core es dueño de la elegibilidad y de la mensajería.
const router = Router();

router.get('/allies/eligible', authenticate, dispatchIntegrationController.listEligibleAllies);
// SCRUM-1652: bajo /allies/eligible para que el Gateway la siga tratando como ruta interna (no se expone).
router.get('/allies/eligible/by-request/:id', authenticate, dispatchIntegrationController.listEligibleAlliesForRequest);
router.get('/allies/me', authenticate, dispatchIntegrationController.getOwnAllyProfile);
router.get('/allies/me/offers', authenticate, dispatchIntegrationController.listOwnOffers);
router.get('/solicitudes/:id/context', authenticate, dispatchIntegrationController.getSolicitudContext);
router.post('/notifications', authenticate, dispatchIntegrationController.publishNotification);
router.get('/notifications', authenticate, dispatchIntegrationController.listNotifications);

module.exports = router;
