const container = require('../container');

/**
 * Los archivos KYC llegan en `req.files` y los campos de texto en `req.body`
 * (multer con multipart/form-data, o express.json() si el caller manda JSON
 * puro sin archivos). `upload.fields()` (ver auth.routes.js) entrega
 * `req.files` como OBJETO { nombreDeCampo: [archivo] }, no como array plano
 * (eso era `upload.any()`, ya reemplazado por la whitelist de campos).
 */
function extraerDocumentos(req) {
  const archivosPorCampo = req.files || {};
  return Object.entries(archivosPorCampo).flatMap(([fieldname, archivos]) =>
    archivos.map((f) => ({
      tipoDocumento: fieldname.toUpperCase(),
      filename: f.originalname,
      contentType: f.mimetype,
      buffer: f.buffer,
    }))
  );
}

async function registerAllyNaturalPerson(req, res, next) {
  try {
    const tenantSlug = req.header('X-Tenant-Slug');
    const result = await container.registerAllyNaturalPersonUseCase.execute({
      tenantSlug,
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone,
      categoriaId: req.body.categoriaId,
      documentType: req.body.documentType,
      documentNumber: req.body.documentNumber,
      documentos: extraerDocumentos(req),
      acceptsTerms: req.body.acceptsTerms,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { registerAllyNaturalPerson };
