const { Router } = require('express');
const multer = require('multer');
const profilesController = require('../../controllers/profiles.controller');

// Dominio Perfiles: perfil propio y categorías que declara el aliado.
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

router.get('/profiles/me', profilesController.getOwnProfile);
// SCRUM-854: una ruta por operación sobre el perfil propio. Los datos van por PATCH (JSON) y la foto
// solo por subida de archivo; no hay ruta por :id porque el caso de uso edita únicamente el perfil propio.
router.patch('/profiles/me', profilesController.updateOwnProfile);
router.post('/profiles/me/photo', photoMiddleware, profilesController.updateOwnProfilePhoto);
router.get('/profiles/me/categories', profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', profilesController.declareAllyCategories);
router.post('/profiles/me/categories', profilesController.declareAllyCategories);

module.exports = router;
