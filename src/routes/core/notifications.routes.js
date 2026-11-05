const { Router } = require('express');
const notificationsController = require('../../controllers/notifications.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// HU-M09-06 (SCRUM-1428): bandeja propia de notificaciones. Va bajo /profiles/me porque el Gateway cierra al
// tráfico externo cualquier ruta /notifications, que es superficie interna de Dispatch.
const router = Router();

router.get('/profiles/me/inbox', authenticate, notificationsController.listMyInbox);

module.exports = router;
