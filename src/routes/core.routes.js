const { Router } = require('express');
const multer = require('multer');
const tenantsController = require('../controllers/tenants.controller');
const profilesController = require('../controllers/profiles.controller');
const catalogController = require('../controllers/catalog.controller');
const availabilityController = require('../controllers/availability.controller');

const router = Router();

const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

const photoMiddleware = uploadPhoto.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'avatar', maxCount: 1 },
  { name: 'foto', maxCount: 1 },
]);

router.get('/tenants', tenantsController.listTenants);
router.get('/profiles/me', profilesController.getOwnProfile);
router.patch('/profiles/me', photoMiddleware, profilesController.updateOwnProfile);
router.put('/profiles/me', photoMiddleware, profilesController.updateOwnProfile);
router.post('/profiles/me/photo', photoMiddleware, profilesController.updateOwnProfile);
router.patch('/profiles/:id', photoMiddleware, profilesController.updateOwnProfile);
router.put('/profiles/:id', photoMiddleware, profilesController.updateOwnProfile);
router.get('/profiles/me/categories', profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', profilesController.declareAllyCategories);
router.post('/profiles/me/categories', profilesController.declareAllyCategories);
router.get('/profiles/me/unavailability', availabilityController.listAbsences);
router.post('/profiles/me/unavailability', availabilityController.createAbsence);
router.patch('/profiles/me/unavailability/:absenceId', availabilityController.updateAbsence);
router.delete('/profiles/me/unavailability/:absenceId', availabilityController.deleteAbsence);
router.get('/catalog', catalogController.listCategories);

module.exports = router;

