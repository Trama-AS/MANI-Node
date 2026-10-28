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

async function updateOwnProfile(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const session = req.user || (await container.tokenService.verifyToken(authHeader));
    const uploadedFiles = req.files || {};
    const fileCandidate =
      req.file ||
      uploadedFiles.photo?.[0] ||
      uploadedFiles.avatar?.[0] ||
      uploadedFiles.foto?.[0] ||
      null;

    const profile = await container.updateOwnProfileUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      targetUserId: req.params?.id || null,
      payload: req.body || {},
      photoFile: fileCandidate,
    });

    res.status(200).json({
      message: 'Perfil actualizado exitosamente',
      correlationId: req.correlationId || 'none',
      profile,
    });
  } catch (err) {
    next(err);
  }
}

async function updateOwnProfilePhoto(req, res, next) {
  const uploadedFiles = req.files || {};
  const hasFile = Boolean(req.file || uploadedFiles.photo?.[0] || uploadedFiles.avatar?.[0] || uploadedFiles.foto?.[0]);
  if (!hasFile) {
    return res.status(400).json({
      error: 'Debe adjuntar la foto de perfil como archivo (campo photo)',
      code: 'MANI-PRF-422',
      correlationId: req.correlationId || 'none',
    });
  }
  return updateOwnProfile(req, res, next);
}

async function listAvailableAllyCategories(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      error: 'Encabezado Authorization requerido',
      correlationId: req.correlationId || 'none',
    });
  }

  try {
    const session = req.user || (await container.tokenService.verifyToken(authHeader));
    const categories = await container.listAvailableAllyCategoriesUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
    });

    res.status(200).json({
      message: 'Categorías disponibles para el aliado',
      correlationId: req.correlationId || 'none',
      categories,
    });
  } catch (err) {
    next(err);
  }
}

// SCRUM-1380: cobertura del aliado. Tenant, usuario y rol salen de `authenticate`; nunca del cuerpo.
async function getAllyCoverage(req, res, next) {
  try {
    const result = await container.getAllyCoverageUseCase.execute({ user: req.user });
    res.status(200).json({ ...result, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

async function declareAllyCoverage(req, res, next) {
  try {
    const result = await container.declareAllyCoverageUseCase.execute({
      user: req.user,
      zoneIds: req.body?.zoneIds ?? req.body?.zonaIds,
    });
    res.status(200).json({ ...result, correlationId: req.correlationId || 'none' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getOwnProfile,
  getAllyCoverage,
  declareAllyCoverage,
  updateOwnProfile,
  getAllyCategories,
  declareAllyCategories,
  listAvailableAllyCategories,
  updateOwnProfilePhoto,
};
