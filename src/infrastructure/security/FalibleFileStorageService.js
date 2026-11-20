const IFileStorageService = require('../../domain/ports/IFileStorageService');
const { DomainError } = require('../../domain/errors/DomainError');

const OPERACIONES = ['upload', 'delete', 'createSignedUrl'];

/**
 * Envuelve un servicio de archivos y hace fallar operaciones a voluntad (SCRUM-1662, QAS-02 y 09), para comprobar la
 * compensación del registro cuando el Storage de KYC cae a mitad de camino. Se activa con `STORAGE_FALLA` (lista de
 * operaciones: `upload`, `delete`, `createSignedUrl`) y `STORAGE_FALLA_DESPUES_DE` (cuántas llamadas de esa operación
 * funcionan antes de empezar a fallar; por omisión 0, que falla desde la primera). Solo fuera de producción.
 *
 * Ejemplo: `STORAGE_FALLA=upload` con `STORAGE_FALLA_DESPUES_DE=1` deja subir el primer documento KYC y falla el segundo,
 * así que el registro debe borrar el primero (compensación) y no dejar nada a medias.
 */
class FalibleFileStorageService extends IFileStorageService {
  constructor({ interno, operaciones = [], despuesDe = 0 } = {}) {
    super();
    if (!interno) throw new Error('interno es requerido para FalibleFileStorageService');
    const desconocidas = operaciones.filter((op) => !OPERACIONES.includes(op));
    if (desconocidas.length > 0) {
      throw new Error(`STORAGE_FALLA con operación desconocida: ${desconocidas.join(', ')}. Válidas: ${OPERACIONES.join(', ')}.`);
    }
    this.interno = interno;
    this.operaciones = new Set(operaciones);
    this.despuesDe = despuesDe;
    this.llamadas = new Map();
  }

  #pasa(operacion) {
    const n = (this.llamadas.get(operacion) ?? 0) + 1;
    this.llamadas.set(operacion, n);
    if (this.operaciones.has(operacion) && n > this.despuesDe) {
      throw new DomainError(
        `MANI-STG-503: falla inyectada en Storage (${operacion}, llamada ${n})`,
        'SERVICE_UNAVAILABLE',
        503
      );
    }
  }

  async upload(args) {
    this.#pasa('upload');
    return this.interno.upload(args);
  }

  async delete(path) {
    this.#pasa('delete');
    return this.interno.delete(path);
  }

  async createSignedUrl(...args) {
    this.#pasa('createSignedUrl');
    return this.interno.createSignedUrl(...args);
  }
}

FalibleFileStorageService.OPERACIONES = OPERACIONES;
module.exports = FalibleFileStorageService;
