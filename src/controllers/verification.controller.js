const container = require('../container');

async function extractSession(req) {
  if (req.user) return req.user;
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    const err = new Error('MANI-VER-401: Encabezado Authorization requerido');
    err.statusCode = 401;
    err.code = 'MANI-VER-401';
    throw err;
  }
  return container.tokenService.verifyToken(authHeader);
}

async function listAlliesVerification(req, res, next) {
  try {
    const session = await extractSession(req);
    const items = await container.listAlliesVerificationUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      estadoVerificacion: req.query?.estado_verificacion ?? req.query?.status,
    });

    res.status(200).json(items);
  } catch (err) {
    next(err);
  }
}

async function getAllyVerificationDetail(req, res, next) {
  try {
    const session = await extractSession(req);
    const detail = await container.getAllyVerificationDetailUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      aliadoId: req.params.id,
    });

    res.status(200).json(detail);
  } catch (err) {
    next(err);
  }
}

async function getKycDocumentSignedUrl(req, res, next) {
  try {
    const session = await extractSession(req);
    const result = await container.getKycDocumentSignedUrlUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      aliadoId: req.params.id ?? req.body?.aliado_id ?? req.body?.aliadoId,
      documentoId: req.params.documentoId ?? req.body?.documento_id ?? req.body?.documentoId,
      rutaStorage: req.body?.ruta_storage ?? req.body?.rutaStorage ?? req.query?.ruta_storage ?? req.query?.path,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function resolveAllyVerification(req, res, next) {
  try {
    const session = await extractSession(req);
    const result = await container.resolveAllyVerificationUseCase.execute({
      userId: session.userId,
      tenantId: session.tenantId,
      role: session.role,
      aliadoId: req.params.id,
      decision: req.body?.decision ?? req.body?.estado_verificacion ?? req.body?.status,
      motivo: req.body?.motivo ?? req.body?.motivo_rechazo ?? req.body?.reason,
      correlationId: req.correlationId || 'none',
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAlliesVerification,
  getAllyVerificationDetail,
  getKycDocumentSignedUrl,
  resolveAllyVerification,
};
