const container = require('../container');

async function getOwnProfile(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const session = req.user || (await container.tokenService.verifyToken(authHeader));
    const profile = await container.getOwnProfileUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
    });

    res.status(200).json({
      message: 'Perfil de usuario autenticado',
      correlationId: req.correlationId || 'none',
      profile,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOwnProfile };

