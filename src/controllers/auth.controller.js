const container = require('../container');

/**
 * Los archivos KYC llegan en `req.files` (multer, campo = tipoDocumento en
 * minúsculas, p. ej. "cedula_ciudadania") y los campos de texto en `req.body`
 * (multer con multipart/form-data, o express.json() si el caller manda JSON
 * puro sin archivos).
 */
function extraerDocumentos(req) {
  const archivos = req.files || [];
  return archivos.map((f) => ({
    tipoDocumento: f.fieldname.toUpperCase(),
    filename: f.originalname,
    contentType: f.mimetype,
    buffer: f.buffer,
  }));
}

async function registerAllyNaturalPerson(req, res, next) {
  try {
    const result = await container.registerAllyNaturalPersonUseCase.execute({
      tenantId: req.header('X-Tenant-Id'),
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone,
      categoriaId: req.body.categoriaId,
      documentType: req.body.documentType,
      documentNumber: req.body.documentNumber,
      documentos: extraerDocumentos(req),
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { registerAllyNaturalPerson };
