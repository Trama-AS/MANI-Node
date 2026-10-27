const crypto = require('node:crypto');
const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIMES_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MIN_OBSERVACION = 3;
const MAX_OBSERVACION = 2000;

// Tipos que el aliado elige al registrar un evento durante la ejecución (RF-18). Se guardan con el prefijo
// EJECUCION_ para distinguirlos de los eventos que registra el sistema (SOLICITUD_CREADA, INICIO_EJECUCION...).
const TIPOS = { AVANCE: 'EJECUCION_AVANCE', NOVEDAD: 'EJECUCION_NOVEDAD', OBSERVACION: 'EJECUCION_OBSERVACION' };

function invalido(mensaje) {
  return new ValidationError(`MANI-EVT-400: ${mensaje}`, 'MANI-EVT-400');
}

function contexto(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-EVT-401: sesión requerida', 'MANI-EVT-401');
  }
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

function solicitudIdValido(valor) {
  if (!UUID_RE.test(String(valor || ''))) throw invalido('el id de la solicitud no es válido');
  return String(valor);
}

function nombreSeguro(value) {
  return String(value || 'evidencia.jpg')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_');
}

/**
 * US-04.3.2 (SCRUM-869, RF-18): el aliado asignado registra eventos durante la ejecución (tipo, observación y
 * evidencia opcional), y el cliente dueño y ese aliado consultan la secuencia. La hora y el autor los pone Core.
 * La evidencia solo entra como archivo: una URL en el cuerpo se rechaza (ADR-0032 §6).
 */
class ServiceEventsUseCase {
  constructor({ serviceEventRepository, fileStorageService }) {
    if (!serviceEventRepository) throw new Error('serviceEventRepository es requerido');
    if (!fileStorageService) throw new Error('fileStorageService es requerido');
    this.serviceEventRepository = serviceEventRepository;
    this.fileStorageService = fileStorageService;
  }

  async registrar({ user, solicitudId, body = {}, file = null }) {
    const ctx = contexto(user);
    if (ctx.role !== 'ALLY') {
      throw new ForbiddenError('MANI-EVT-403: solo el aliado asignado registra eventos del servicio', 'MANI-EVT-403');
    }
    const id = solicitudIdValido(solicitudId);

    const tipo = TIPOS[String(body.tipo ?? 'OBSERVACION').trim().toUpperCase()];
    if (!tipo) throw invalido(`tipo debe ser uno de ${Object.keys(TIPOS).join(', ')}`);
    const observacion = String(body.observacion ?? '').trim();
    if (observacion.length < MIN_OBSERVACION || observacion.length > MAX_OBSERVACION) {
      throw invalido(`la observación debe tener entre ${MIN_OBSERVACION} y ${MAX_OBSERVACION} caracteres`);
    }
    if (body.fotoUrl !== undefined && body.fotoUrl !== null && body.fotoUrl !== '') {
      throw invalido('la evidencia se adjunta como archivo (campo foto), no como URL');
    }
    if (file && !MIMES_IMAGEN.has(String(file.mimetype || '').toLowerCase())) {
      throw invalido('la evidencia debe ser una imagen PNG, JPEG o WEBP');
    }
    const clave = body.claveIdempotencia ? String(body.claveIdempotencia) : null;
    if (clave && !UUID_RE.test(clave)) throw invalido('la clave de idempotencia no es un UUID');

    // La foto se sube antes de la transacción; si el registro falla o era un reintento, se borra.
    let evidenciaRuta = null;
    if (file) {
      evidenciaRuta = `${ctx.tenantId}/${ctx.userId}/eventos/${id}/${crypto.randomUUID()}-${nombreSeguro(file.originalname)}`;
      await this.fileStorageService.upload({
        path: evidenciaRuta,
        buffer: file.buffer,
        contentType: file.mimetype,
        bucket: 'solicitudes',
      });
    }
    try {
      const resultado = await this.serviceEventRepository.registrar(ctx, {
        solicitudId: id,
        tipo,
        observacion,
        evidenciaRuta,
        claveIdempotencia: clave,
      });
      if (!resultado.creado) await this.descartar(evidenciaRuta);
      return resultado;
    } catch (err) {
      await this.descartar(evidenciaRuta);
      throw err;
    }
  }

  async listar({ user, solicitudId }) {
    const ctx = contexto(user);
    if (ctx.role !== 'ALLY' && ctx.role !== 'CLIENT') {
      throw new ForbiddenError(
        'MANI-EVT-403: solo el cliente dueño o el aliado asignado consultan los eventos',
        'MANI-EVT-403'
      );
    }
    return this.serviceEventRepository.listar(ctx, solicitudIdValido(solicitudId));
  }

  async descartar(ruta) {
    if (!ruta) return;
    try {
      await this.fileStorageService.delete(ruta, { bucket: 'solicitudes' });
    } catch {
      // La compensación no debe ocultar el error original.
    }
  }
}

ServiceEventsUseCase.TIPOS = TIPOS;
module.exports = ServiceEventsUseCase;
