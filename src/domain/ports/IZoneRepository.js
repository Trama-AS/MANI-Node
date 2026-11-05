/**
 * Interfaz / Puerto de Dominio para el catálogo geográfico de zonas.
 *
 * `zona` es un catálogo global compartido por todos los tenants (no tiene
 * columna tenant_id), así que ningún método recibe tenantId: hacerlo
 * sugeriría un filtro que la tabla no puede cumplir. La autorización vive en
 * el borde HTTP (JWT verificado, T4/T7).
 */
class IZoneRepository {
  /**
   * Catálogo completo, ordenado por nivel y nombre.
   * @param {{ onlyActive?: boolean }} [options]
   * @returns {Promise<import('../entities/Zone')[]>}
   */
  async findAll(_options) {
    throw new Error('Método findAll() no implementado en IZoneRepository');
  }

  /**
   * @returns {Promise<import('../entities/Zone')|null>} null si el id no existe.
   */
  async findById(_zoneId) {
    throw new Error('Método findById() no implementado en IZoneRepository');
  }

  /**
   * Límites geográficos de las zonas pedidas, como GeoJSON (SCRUM-1396).
   *
   * Va en una consulta aparte y no en `findAll` porque la geometría es
   * opcional y pesada: el catálogo se lee en cada listado y formulario, y
   * arrastrarla ahí degradaría respuestas que ya están validadas.
   *
   * Devuelve solo las zonas que tienen geometría. Las que no la tienen se
   * omiten, y distinguir «sin geometría» de «zona inexistente» le
   * corresponde al caso de uso, que sí conoce el catálogo (criterio C2).
   *
   * @param {string[]} _zoneIds
   * @returns {Promise<Array<{zoneId: string, geometry: object, source: string,
   *   sourceCode: string|null, licence: string, attribution: string,
   *   sourceDate: string|null, updatedAt: string}>>}
   */
  async findGeometriesByZoneIds(_zoneIds) {
    throw new Error('Método findGeometriesByZoneIds() no implementado en IZoneRepository');
  }
}

module.exports = IZoneRepository;
