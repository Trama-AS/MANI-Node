/**
 * Entidad de Dominio: Empleado Directo
 * Representa un aliado de tipo EMPLEADO_DIRECTO (RF-05).
 * A diferencia de un aliado externo, no requiere flujo de aprobación
 * ni carga de documentos KYC. Es creado directamente por el Admin del Tenant.
 */
class DirectEmployee {
  /**
   * @param {object} data
   * @param {string} data.id
   * @param {string} data.tenantId       - Tenant al que pertenece
   * @param {string} data.nombre
   * @param {string} data.email
   * @param {string} [data.telefono]
   * @param {string} [data.fotoPerfil]
   * @param {string} [data.categoriaId]  - Categoría asignada por el Admin
   * @param {string} [data.zonaId]       - Zona de cobertura asignada
   * @param {Date}   [data.creadoEn]
   */
  constructor({ id, tenantId, nombre, email, telefono, fotoPerfil, categoriaId, zonaId, creadoEn }) {
    this.id = id;
    this.tenantId = tenantId;
    this.nombre = nombre;
    this.email = email;
    this.telefono = telefono ?? null;
    this.fotoPerfil = fotoPerfil ?? null;
    this.categoriaId = categoriaId ?? null;
    this.zonaId = zonaId ?? null;
    this.tipoAliado = 'EMPLEADO_DIRECTO';       // RF-05: marcado explícito de tipo
    this.estadoVerificacion = 'APROBADO';        // Sin flujo KYC, entra directamente activo
    this.creadoEn = creadoEn ?? new Date();
  }

  /**
   * Valida que los campos obligatorios estén presentes.
   * @throws {Error} si falta algún campo requerido.
   */
  validate() {
    if (!this.tenantId) throw new Error('tenantId es requerido');
    if (!this.nombre || this.nombre.trim().length < 2) throw new Error('nombre inválido (mínimo 2 caracteres)');
    if (!this.email || !this.email.includes('@')) throw new Error('email inválido');
    return true;
  }
}

module.exports = { DirectEmployee };
