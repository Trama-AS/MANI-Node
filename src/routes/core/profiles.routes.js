const { Router } = require('express');
const multer = require('multer');
const { authenticate, identificarSiHayToken } = require('../../middlewares/auth.middleware');
const profilesController = require('../../controllers/profiles.controller');
const { DomainError } = require('../../domain/errors/DomainError');

// Dominio Perfiles: perfil propio y categorías que declara el aliado.
// identificarSiHayToken fija la identidad para app.set_context sin cambiar el 401 de los controladores (SCRUM-1468).
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

router.get('/profiles/me', identificarSiHayToken, profilesController.getOwnProfile);
// SCRUM-854: una ruta por operación sobre el perfil propio. Los datos van por PATCH (JSON) y la foto
// solo por subida de archivo; no hay ruta por :id porque el caso de uso edita únicamente el perfil propio.
router.patch('/profiles/me', identificarSiHayToken, profilesController.updateOwnProfile);
// Después de multer: los eventos del stream de la subida no conservan la identidad de AsyncLocalStorage.
router.post('/profiles/me/photo', photoMiddleware, identificarSiHayToken, profilesController.updateOwnProfilePhoto);
router.get('/profiles/me/categories', identificarSiHayToken, profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', identificarSiHayToken, profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', identificarSiHayToken, profilesController.declareAllyCategories);
router.post('/profiles/me/categories', identificarSiHayToken, profilesController.declareAllyCategories);

// SCRUM-1380: cobertura del aliado (reemplaza las RPC obtener_mi_cobertura y declarar_cobertura de Supabase).
router.get('/profiles/me/coverage', authenticate, profilesController.getAllyCoverage);
router.put('/profiles/me/coverage', authenticate, profilesController.declareAllyCoverage);

// SCRUM-1628: multer corta una foto de más de 5 MB con «File too large». Este manejador va después de las rutas, así la
// cadena de middlewares de cada ruta no cambia, y responde con un código propio que dice el límite.
router.use('/profiles/me/photo', (err, _req, _res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return next(new DomainError('La foto debe ser JPG o PNG de hasta 5 MB', 'MANI-PRF-413', 413));
  }
  return next(err);
});

module.exports = router;
