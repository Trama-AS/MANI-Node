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

async function registerAllyCompany(req, res, next) {
  try {
    const tenantSlug = req.header('X-Tenant-Slug');
    const result = await container.registerAllyCompanyUseCase.execute({
      tenantSlug,
      razonSocial: req.body.razon_social ?? req.body.razonSocial,
      nit: req.body.nit,
      nombreRepresentante: req.body.nombre_representante ?? req.body.nombreRepresentante,
      docRepresentante: req.body.doc_representante ?? req.body.docRepresentante,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.telefono_contacto ?? req.body.phone,
      categoriaId: req.body.categoria_id ?? req.body.categoriaId,
      documentos: extraerDocumentos(req),
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// Registro de Cliente persona natural (US-02.2.1-M2): sin archivos, body
// JSON puro (express.json(), sin multer -- a diferencia del registro de
// Aliado, que sí requiere KYC multipart).
async function registerClientNaturalPerson(req, res, next) {
  try {
    const tenantSlug = req.header('X-Tenant-Slug');
    const result = await container.registerClientNaturalPersonUseCase.execute({
      tenantSlug,
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone,
      direccionHogar: req.body.direccionHogar,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

// HU-M02-07 (SCRUM-1375): alta de cliente empresa, pre-auth y sin sitios.
async function registerClientCompany(req, res, next) {
  try {
    const result = await container.registerClientCompanyUseCase.execute({
      tenantSlug: req.header('X-Tenant-Slug'),
      razonSocial: req.body.razonSocial,
      nit: req.body.nit,
      nombreRepresentante: req.body.nombreRepresentante,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone,
      acceptsTerms: req.body.acceptsTerms,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { registerAllyNaturalPerson, registerAllyCompany, registerClientNaturalPerson, registerClientCompany };
