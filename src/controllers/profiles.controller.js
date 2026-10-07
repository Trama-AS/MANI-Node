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

async function getAllyCategories(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const session = req.user || (await container.tokenService.verifyToken(authHeader));
    const categories = await container.getAllyCategoriesUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
    });

    res.status(200).json({
      message: 'Categorías atendidas por el aliado',
      correlationId: req.correlationId || 'none',
      categories,
      categoryIds: categories,
      data: categories,
    });
  } catch (err) {
    next(err);
  }
}

async function declareAllyCategories(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const session = req.user || (await container.tokenService.verifyToken(authHeader));
    const rawCategories =
      req.body?.categoriaIds ??
      req.body?.categoryIds ??
      req.body?.categories ??
      (Array.isArray(req.body) ? req.body : null);

    const categories = await container.declareAllyCategoriesUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      categoryIds: rawCategories,
    });

    res.status(200).json({
      message: 'Categorías actualizadas exitosamente',
      correlationId: req.correlationId || 'none',
      categories,
      categoryIds: categories,
      data: categories,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getOwnProfile, getAllyCategories, declareAllyCategories };

