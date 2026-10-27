const { Router } = require('express');
const availabilityController = require('../../controllers/availability.controller');

// Dominio Disponibilidad del aliado (SCRUM-855, ADR-0028): ausencias por intervalos.
const router = Router();

router.get('/profiles/me/unavailability', availabilityController.listAbsences);
router.post('/profiles/me/unavailability', availabilityController.createAbsence);
router.patch('/profiles/me/unavailability/:absenceId', availabilityController.updateAbsence);
router.delete('/profiles/me/unavailability/:absenceId', availabilityController.deleteAbsence);

module.exports = router;
