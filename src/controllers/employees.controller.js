const container = require('../container');

/**
 * Controlador HTTP para Empleados Directos (RF-05 / US-02.1.5 / SCRUM-850)
 */
async function registerDirectEmployee(req, res, next) {
  const correlationId = req.correlationId || res.getHeader('X-Correlation-ID') || `node-${Date.now()}`;

  // ADR-0018: el tenantId proviene EXCLUSIVAMENTE de la sesión autenticada (JWT claim)
  const tenantId = req.user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({
      error: 'Sesión sin tenant_id asociado',
      code: 'UNAUTHORIZED',
      correlationId,
    });
  }

  const {
    fullName,
    nombre,
    email,
    password,
    phone,
    telefono,
    documentType,
    tipoDocumento,
    documentNumber,
    numeroDocumento,
    categoriaId,
  } = req.body || {};

  try {
    const result = await container.registerDirectEmployeeUseCase.execute({
      tenantId,
      fullName: fullName || nombre,
      email,
      password,
      phone: phone || telefono,
      documentType: documentType || tipoDocumento,
      documentNumber: documentNumber || numeroDocumento,
      categoriaId,
    });

    return res.status(201).json({
      message: 'Empleado directo registrado exitosamente. No requirió flujo de aprobación KYC.',
      correlationId,
      tenantId,
      employee: result.employee,
      temporaryPassword: result.temporaryPassword,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { registerDirectEmployee };
