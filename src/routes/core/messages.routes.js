const { Router } = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const messagesController = require('../../controllers/messages.controller');

// Módulo de mensajería de Core (dominio M-09). Cada dominio tiene su archivo en src/routes/core/ para que dos
// historias no editen el mismo archivo de rutas.
const router = Router();

// HU-M09-02 (SCRUM-881): el cliente dueño y el aliado asignado intercambian mensajes por servicio.
router.post('/solicitudes/:id/mensajes', authenticate, messagesController.sendMessage);
router.get('/solicitudes/:id/mensajes', authenticate, messagesController.listMessages);

module.exports = router;
