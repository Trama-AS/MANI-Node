class DomainError extends Error {
  constructor(message, code = 'DOMAIN_ERROR', statusCode = 400) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends DomainError {
  constructor(message = 'Recurso no encontrado', code = 'NOT_FOUND') {
    super(message, code, 404);
  }
}

class UnauthorizedError extends DomainError {
  constructor(message = 'No autorizado', code = 'UNAUTHORIZED') {
    super(message, code, 401);
  }
}

class ForbiddenError extends DomainError {
  constructor(message = 'Acceso denegado', code = 'FORBIDDEN') {
    super(message, code, 403);
  }
}

class ValidationError extends DomainError {
  constructor(message = 'Datos de entrada inválidos', code = 'VALIDATION_ERROR') {
    super(message, code, 400);
  }
}

// Reglas de negocio incumplidas según el Rules Service: conserva el 400
// VALIDATION_ERROR que Core ya devolvía y agrega el detalle de cada regla.
class RuleViolationError extends ValidationError {
  constructor(violations, message = 'La categoría no cumple las reglas de negocio') {
    super(message);
    this.violations = violations;
  }
}

class ConflictError extends DomainError {
  constructor(message = 'Conflicto en la operación', code = 'CONFLICT') {
    super(message, code, 409);
  }
}

module.exports = {
  DomainError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  RuleViolationError,
  ConflictError,
};

