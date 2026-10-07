// El dominio/contrato OpenAPI habla en inglés (ALLY, ACTIVE, PENDING); el esquema
// de Postgres heredado del flujo Flutter/handle_new_user usa español (ALIADO,
// ACTIVO, PENDIENTE). Esta es la única frontera de traducción entre ambos.
const ROL_TO_DB = { ALLY: 'ALIADO', CLIENT: 'CLIENTE', ADMIN: 'ADMIN' };
const ESTADO_USUARIO_TO_DB = { ACTIVE: 'ACTIVO', INACTIVE: 'INACTIVO' };
const ESTADO_VERIFICACION_TO_DB = { PENDING: 'PENDIENTE', VERIFIED: 'VERIFICADO', REJECTED: 'RECHAZADO' };

module.exports = { ROL_TO_DB, ESTADO_USUARIO_TO_DB, ESTADO_VERIFICACION_TO_DB };
