const Site = require('../../../domain/entities/Site');
const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');
const { assertClientOwnerOrAdmin, cargarCliente } = require('./clientAccess');

/** Campos de la sede que se editan aquí. Las reglas tienen su propia operación (PATCH /sites/:id/rules, SCRUM-853). */
const CAMPOS_EDITABLES = ['nombre', 'direccion', 'zonaId', 'contactoNombre', 'contactoTelefono'];
const CAMPOS_ANULABLES = ['contactoNombre', 'contactoTelefono'];

/**
 * Caso de Uso: Editar una sede de un cliente empresa (SCRUM-1387 / HU-M03-04 / CONS-16 / RF-08).
 * Edición parcial: solo cambian los campos que llegan. La sede sigue necesitando dirección y zona (RF-09), así que
 * el resultado se valida completo antes de guardar; si algo no cumple, se rechaza y no se modifica nada (C2).
 * Solo el cliente dueño o el admin de su tenant la editan (C4), y la sede debe ser de ese cliente y de ese tenant:
 * si no, 404 sin datos (C3).
 */
class UpdateCompanyClientSiteUseCase {
  /**
   * @param {import('../../../domain/ports/ICompanyClientRepository')} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en UpdateCompanyClientSiteUseCase');
    this.repository = repository;
  }

  /**
   * @param {object} input
   * @param {string} input.clienteId - Id del cliente o `me` para el cliente de la sesión
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {object} [input.cambios] - Subconjunto de nombre, direccion, zonaId, contactoNombre, contactoTelefono
   * @param {string} [input.userId]
   * @param {string} [input.userRole]
   * @param {string} [input.correlationId]
   * @returns {Promise<import('../../../domain/entities/Site')>}
   */
  async execute({ clienteId, siteId, tenantId, cambios, userId, userRole, correlationId = 'none' }) {
    if (!clienteId) throw new ValidationError('clienteId es requerido', 'VALIDATION_ERROR');
    if (!siteId) throw new ValidationError('siteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const datos = validarCambios(cambios);

    const client = await cargarCliente(this.repository, { clienteId, tenantId, userId });

    assertClientOwnerOrAdmin({
      client,
      userId,
      userRole,
      mensaje: 'No tiene permisos para modificar sedes de este cliente empresa',
    });

    const actual = await this.repository.findSiteById(client.id, siteId, tenantId);
    if (!actual) {
      throw new NotFoundError(`Sitio con ID "${siteId}" no encontrado para este cliente.`, 'SITE_NOT_FOUND');
    }

    const editada = new Site({ ...actual.toJSON(), ...datos });
    editada.validate();

    const guardada = await this.repository.updateSite(client.id, tenantId, editada);
    if (!guardada) {
      throw new NotFoundError(`Sitio con ID "${siteId}" no encontrado para este cliente.`, 'SITE_NOT_FOUND');
    }
    console.log(
      `[UpdateCompanyClientSiteUseCase] Sitio "${guardada.id}" del cliente "${client.id}" editado (${Object.keys(datos).join(', ')}). Corr: ${correlationId}`
    );
    return guardada;
  }
}

/**
 * Valida la forma del cuerpo antes de tocar la base: campos conocidos, de tipo texto y al menos uno.
 * @returns {object} Los cambios a aplicar.
 */
function validarCambios(cambios) {
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios)) {
    throw new ValidationError('El cuerpo de la edición debe ser un objeto', 'VALIDATION_ERROR');
  }
  if (Object.prototype.hasOwnProperty.call(cambios, 'reglas')) {
    throw new ValidationError('Las reglas del sitio se configuran en PATCH /sites/:id/rules', 'VALIDATION_ERROR');
  }
  const desconocidos = Object.keys(cambios).filter((campo) => !CAMPOS_EDITABLES.includes(campo));
  if (desconocidos.length > 0) {
    throw new ValidationError(`Campos no editables: ${desconocidos.join(', ')}`, 'VALIDATION_ERROR');
  }

  const datos = {};
  for (const campo of CAMPOS_EDITABLES) {
    if (!Object.prototype.hasOwnProperty.call(cambios, campo)) continue;
    const valor = cambios[campo];
    if (valor === null && CAMPOS_ANULABLES.includes(campo)) {
      datos[campo] = null;
    } else if (typeof valor === 'string') {
      datos[campo] = valor;
    } else {
      throw new ValidationError(`${campo} debe ser texto`, 'VALIDATION_ERROR');
    }
  }
  if (Object.keys(datos).length === 0) {
    throw new ValidationError(`Indique al menos un campo a editar: ${CAMPOS_EDITABLES.join(', ')}`, 'VALIDATION_ERROR');
  }
  if (datos.nombre !== undefined && datos.nombre.trim() === '') {
    throw new ValidationError('nombre del sitio no puede quedar vacío', 'VALIDATION_ERROR');
  }
  return datos;
}

UpdateCompanyClientSiteUseCase.UpdateCompanyClientSiteUseCase = UpdateCompanyClientSiteUseCase;
module.exports = UpdateCompanyClientSiteUseCase;
