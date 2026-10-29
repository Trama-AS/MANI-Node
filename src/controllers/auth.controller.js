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

const correlationOf = (req, res) => req.correlationId || res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'];

// HU-M02-10 (SCRUM-1378): siempre 202 con el mismo mensaje, exista o no la cuenta.
async function requestPasswordRecovery(req, res, next) {
  try {
    await container.requestPasswordRecoveryUseCase.execute({
      tenantSlug: req.header('X-Tenant-Slug'),
      email: req.body?.email,
      correlationId: correlationOf(req, res),
    });
    res.status(202).json({ message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    await container.resetPasswordUseCase.execute({
      tenantSlug: req.header('X-Tenant-Slug'),
      accessToken: req.body?.accessToken,
      newPassword: req.body?.newPassword,
      correlationId: correlationOf(req, res),
    });
    res.status(200).json({ message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    next(err);
  }
}

// HU-M02-03 (SCRUM-1371): constancia del cierre de sesión. La sesión la deja `authenticate` a partir del JWT.
function logout(req, res, next) {
  try {
    container.logoutUseCase.execute({ session: req.user, correlationId: correlationOf(req, res) });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  logout,
  registerAllyNaturalPerson,
  registerAllyCompany,
  registerClientNaturalPerson,
  registerClientCompany,
  requestPasswordRecovery,
  resetPassword,
};
