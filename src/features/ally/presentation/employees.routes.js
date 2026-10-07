const { Router } = require('express');
const { RegisterDirectEmployeeUseCase } = require('../application/RegisterDirectEmployeeUseCase');
const { PostgresDirectEmployeeRepository } = require('../infrastructure/PostgresDirectEmployeeRepository');

const router = Router();

// Composición de dependencias (Dependency Injection manual)
const repo = new PostgresDirectEmployeeRepository();
const registerUseCase = new RegisterDirectEmployeeUseCase(repo);

/**
 * POST /api/v1/allies/employees
 * Registra un empleado directo del tenant (RF-05).
 * No requiere flujo KYC. El admin envía los datos y el empleado queda APROBADO de inmediato.
 *
 * Headers requeridos:
 *   X-Correlation-ID : (propagado por el Gateway)
 *   X-Tenant-Id      : Tenant del admin autenticado
 *
 * Body:
 *   { nombre, email, telefono?, fotoPerfil?, categoriaId?, zonaId? }
 */
router.post('/', async (req, res) => {
  const correlationId = res.getHeader('X-Correlation-ID') || req.headers['x-correlation-id'] || `node-${Date.now()}`;
  const tenantId = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'] || req.body?.tenantId;

  if (!tenantId) {
    return res.status(400).json({
      error: 'Header X-Tenant-Id es requerido para registrar un empleado directo.',
      correlationId,
    });
  }

  const { nombre, email, telefono, fotoPerfil, categoriaId, zonaId } = req.body ?? {};

  try {
    const { employee, isNew } = await registerUseCase.execute({
      tenantId,
      nombre,
      email,
      telefono,
      fotoPerfil,
      categoriaId,
      zonaId,
      correlationId,
    });

    const statusCode = isNew ? 201 : 200;
    return res.status(statusCode).json({
      message: isNew
        ? 'Empleado directo registrado exitosamente. No requirió flujo de aprobación KYC.'
        : 'El empleado directo ya existía en este tenant. Se retorna el registro existente.',
      correlationId,
      tenantId,
      isNew,
      employee: {
        id: employee.id,
        nombre: employee.nombre,
        email: employee.email,
        telefono: employee.telefono,
        tipoAliado: employee.tipoAliado,
        estadoVerificacion: employee.estadoVerificacion,
        categoriaId: employee.categoriaId,
        zonaId: employee.zonaId,
        creadoEn: employee.creadoEn,
      },
    });
  } catch (err) {
    if (err.message.includes('inválido') || err.message.includes('requerido')) {
      return res.status(400).json({ error: err.message, correlationId });
    }
    console.error(`[EmployeesController] Error inesperado - Correlation: ${correlationId}`, err);
    return res.status(500).json({ error: 'Error interno del servidor.', correlationId });
  }
});

module.exports = router;
