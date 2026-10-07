const { Router } = require('express');
const authController = require('../controllers/auth.controller');

const router = Router();

router.post('/auth/register/ally', authController.registerAllyNaturalPerson);

module.exports = router;
