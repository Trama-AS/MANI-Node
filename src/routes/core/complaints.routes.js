const { Router } = require('express');
const complaintsController = require('../../controllers/complaints.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

// Dominio Quejas (M-12). El rol lo decide el caso de uso.
const router = Router();

// SCRUM-895: el cliente presenta una queja sobre un servicio propio y consulta las suyas.
router.post('/solicitudes/:id/quejas', authenticate, complaintsController.createComplaint);
router.get('/quejas/mias', authenticate, complaintsController.listOwnComplaints);
// SCRUM-896: el administrador del tenant lista las quejas y cambia su estado. `/quejas/mias` va antes de `/quejas/:id`.
router.get('/quejas', authenticate, complaintsController.listComplaints);
router.get('/quejas/:id', authenticate, complaintsController.getComplaint);
router.patch('/quejas/:id/estado', authenticate, complaintsController.changeComplaintStatus);

module.exports = router;
