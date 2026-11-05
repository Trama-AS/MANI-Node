const { Router } = require('express');
const { identificarSiHayToken } = require('../../middlewares/auth.middleware');
const availabilityController = require('../../controllers/availability.controller');

// Dominio Disponibilidad del aliado (SCRUM-855, ADR-0028): ausencias por intervalos.
// identificarSiHayToken fija la identidad para app.set_context sin cambiar el 401 del controlador (SCRUM-1468).
const router = Router();

router.get('/profiles/me/unavailability', identificarSiHayToken, availabilityController.listAbsences);
router.post('/profiles/me/unavailability', identificarSiHayToken, availabilityController.createAbsence);
router.patch('/profiles/me/unavailability/:absenceId', identificarSiHayToken, availabilityController.updateAbsence);
router.delete('/profiles/me/unavailability/:absenceId', identificarSiHayToken, availabilityController.deleteAbsence);

module.exports = router;
