const container = require('../container');

/**
 * categoriaIds llega como lista JSON, como campo repetido de multipart (categoriaIds o categoriaIds[]) o como texto
 * separado por comas. categoriaId (una sola) se conserva por compatibilidad con SCRUM-850.
 */
function parseCategoriaIds(body) {
  let raw = body.categoriaIds;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('[')) {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = [];
      }
    } else {
      raw = text.split(',');
    }
  }
  const list = Array.isArray(raw) ? raw : [];
  if (body.categoriaId) list.push(body.categoriaId);
  return list.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean);
}

/**
 * Controlador HTTP para Empleados Directos (RF-05 / US-02.1.5 / SCRUM-850 / SCRUM-1376).
 * multipart/form-data con la copia del documento de identidad en el campo `documento_identidad`.
 */
async function registerDirectEmployee(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;

  // ADR-0018: el tenantId proviene EXCLUSIVAMENTE de la sesión autenticada (JWT claim); un tenantId del cuerpo,
  // de la consulta o de un encabezado se ignora (C3).
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión sin tenant_id asociado',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  const body = req.body || {};

  try {
    const result = await container.registerDirectEmployeeUseCase.execute({
      tenantId,
      adminUserId: req.user.userId,
      correlationId,
      fullName: body.fullName || body.nombre || body.nombreCompleto,
      email: body.email,
      password: body.password,
      phone: body.phone || body.telefono,
      documentType: body.documentType || body.tipoDocumento,
      documentNumber: body.documentNumber || body.numeroDocumento,
      categoriaIds: parseCategoriaIds(body),
      documento: req.file
        ? { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname }
        : null,
    });

    return res.status(201).json({
      message: 'Empleado directo registrado exitosamente. Queda verificado; no pasa por la bandeja de verificación.',
      correlationId,
      tenantId,
      employee: result.employee,
      temporaryPassword: result.temporaryPassword,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { registerDirectEmployee, parseCategoriaIds };
