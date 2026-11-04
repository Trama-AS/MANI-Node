const { Router } = require('express');
const multer = require('multer');
const { authenticate } = require('../../middlewares/auth.middleware');
const profilesController = require('../../controllers/profiles.controller');
const { DomainError } = require('../../domain/errors/DomainError');

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

// `authenticate` resuelve la sesión efectiva (SCRUM-901): el administrador de plataforma que actúa como un usuario
// ve y edita el perfil de ese usuario. Los controladores ya usaban req.user cuando existía.
router.get('/profiles/me', authenticate, profilesController.getOwnProfile);
// SCRUM-854: una ruta por operación sobre el perfil propio. Los datos van por PATCH (JSON) y la foto
// solo por subida de archivo; no hay ruta por :id porque el caso de uso edita únicamente el perfil propio.
router.patch('/profiles/me', authenticate, profilesController.updateOwnProfile);
router.post('/profiles/me/photo', authenticate, photoMiddleware, profilesController.updateOwnProfilePhoto);
router.get('/profiles/me/categories', authenticate, profilesController.getAllyCategories);
router.get('/profiles/me/categories/available', authenticate, profilesController.listAvailableAllyCategories);
router.put('/profiles/me/categories', authenticate, profilesController.declareAllyCategories);
router.post('/profiles/me/categories', authenticate, profilesController.declareAllyCategories);

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
