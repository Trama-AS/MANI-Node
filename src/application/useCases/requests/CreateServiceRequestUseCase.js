const crypto = require('node:crypto');
const { DomainError, ForbiddenError, UnauthorizedError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FOTOS = 5;
const MIMES_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp']);

function rechazo(codigo, mensaje) {
  return new DomainError(`${codigo}: ${mensaje}`, codigo, 422);
}

function uuidOpcional(valor, codigo, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  if (!UUID_RE.test(String(valor))) throw rechazo(codigo, `${campo} no es un identificador válido`);
  return String(valor);
}

function nombreSeguro(value) {
  return String(value || 'foto.jpg')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_');
}

/**
 * US-04.1.1-M2 (SCRUM-1072): el cliente crea una solicitud de servicio en Core Node, separada del despacho
 * (ARQ-03: Core crea, Dispatch orquesta). Porta `crear_solicitud` al servicio (ADR-0022): mismas validaciones
 * y códigos MANI-SOL-*, idempotencia por clave y fotos subidas por Core al bucket `solicitudes`
 * (Flutter ya no usa `.rpc()` ni `.storage.from()`, ADR-0027).
 */
class CreateServiceRequestUseCase {
  constructor({ serviceRequestRepository, fileStorageService }) {
    if (!serviceRequestRepository) throw new Error('serviceRequestRepository es requerido');
    if (!fileStorageService) throw new Error('fileStorageService es requerido');
    this.serviceRequestRepository = serviceRequestRepository;
    this.fileStorageService = fileStorageService;
  }

  async execute({ user, body = {}, files = [] }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new UnauthorizedError('MANI-SOL-401: sesión requerida', 'MANI-SOL-401');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-SOL-403C: solo un cliente activo puede publicar solicitudes', 'MANI-SOL-403C');
    }
    if (!UUID_RE.test(String(user.userId))) {
      throw new UnauthorizedError('MANI-SOL-401: sesión sin identificador de usuario válido', 'MANI-SOL-401');
    }

    const categoriaId = uuidOpcional(body.categoriaId, 'MANI-SOL-422C', 'categoriaId');
    if (!categoriaId) throw rechazo('MANI-SOL-422C', 'categoría no disponible');

    const descripcion = String(body.descripcion ?? '').trim();
    if (descripcion.length < 20 || descripcion.length > 1000) {
      throw rechazo('MANI-SOL-422D', 'la descripción debe tener entre 20 y 1000 caracteres');
    }

    const sitioId = uuidOpcional(body.sitioId, 'MANI-SOL-422S', 'sitioId');
    let direccion = null;
    let zonaId = null;
    if (!sitioId) {
      direccion = String(body.direccion ?? '').trim().replace(/\s+/g, ' ');
      if (direccion.length < 5 || direccion.length > 200) {
        throw rechazo('MANI-SOL-422S', 'la dirección debe tener entre 5 y 200 caracteres');
      }
      zonaId = uuidOpcional(body.zonaId, 'MANI-SOL-422Z', 'zonaId');
      if (!zonaId) throw rechazo('MANI-SOL-422Z', 'zona no disponible');
    }

    const claveIdempotencia = uuidOpcional(body.claveIdempotencia, 'MANI-SOL-422K', 'claveIdempotencia');

    if (files.length > MAX_FOTOS || files.some((f) => !MIMES_IMAGEN.has(String(f.mimetype || '').toLowerCase()))) {
      throw rechazo('MANI-SOL-422F', 'fotos inválidas (máximo 5 imágenes PNG, JPEG o WEBP)');
    }

    // Las fotos se suben antes de la transacción; si la creación falla o resulta ser un reintento, se borran.
    const subidas = [];
    try {
      for (const file of files) {
        const ruta = `${user.tenantId}/${user.userId}/${crypto.randomUUID()}-${nombreSeguro(file.originalname)}`;
        await this.fileStorageService.upload({ path: ruta, buffer: file.buffer, contentType: file.mimetype, bucket: 'solicitudes' });
        subidas.push(ruta);
      }

      const resultado = await this.serviceRequestRepository.crear(
        { tenantId: user.tenantId, userId: user.userId, role: user.role },
        { categoriaId, descripcion, sitioId, direccion, zonaId, fotos: subidas, claveIdempotencia }
      );
      if (!resultado.creada) await this.descartar(subidas);
      return resultado;
    } catch (err) {
      await this.descartar(subidas);
      throw err;
    }
  }

  async descartar(rutas) {
    for (const ruta of rutas) {
      try {
        await this.fileStorageService.delete(ruta, { bucket: 'solicitudes' });
      } catch {
        // La compensación no debe ocultar el error original.
      }
    }
  }
}

module.exports = CreateServiceRequestUseCase;
