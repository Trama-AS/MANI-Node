const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

const ESTADOS_CERRADOS = ['FINALIZADA', 'CANCELADA', 'RECHAZADA'];
const MIMES_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp']);

function nombreSeguro(value) {
  return String(value || 'evidencia.jpg')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_');
}

/**
 * US-04.3.2 (SCRUM-869): el aliado asignado registra eventos e imprevistos durante la ejecución.
 * - Se guardan en `evento_servicio` (no existe `historial_solicitud`).
 * - El aliado se resuelve desde el usuario del JWT y se compara con `solicitud.aliado_id`.
 * - La evidencia fotográfica solo entra como archivo subido a Storage con ruta {tenant}/{usuario}/eventos/...;
 *   una URL en el cuerpo se rechaza (ADR-0032 §6).
 */
class RegisterServiceEventUseCase {
  constructor({ solicitudRepository, eventoServicioRepository, aliadoRepository, fileStorageService }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!eventoServicioRepository) throw new Error('eventoServicioRepository es requerido');
    if (!aliadoRepository) throw new Error('aliadoRepository es requerido');
    if (!fileStorageService) throw new Error('fileStorageService es requerido');

    this.solicitudRepository = solicitudRepository;
    this.eventoServicioRepository = eventoServicioRepository;
    this.aliadoRepository = aliadoRepository;
    this.fileStorageService = fileStorageService;
  }

  async execute({ user, solicitudId, observacion, fotoUrl, file }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo el aliado asignado puede registrar eventos durante la ejecución');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }
    if (fotoUrl !== undefined && fotoUrl !== null && fotoUrl !== '') {
      throw new ValidationError('La evidencia solo se adjunta como archivo (campo foto), no como URL');
    }

    const texto = String(observacion || '').trim();
    if (texto.length < 3) {
      throw new ValidationError('El comentario u observación del evento es obligatorio (mínimo 3 caracteres)');
    }
    if (texto.length > 2000) {
      throw new ValidationError('El comentario no puede superar los 2000 caracteres');
    }
    if (file && !MIMES_IMAGEN.has(String(file.mimetype || '').toLowerCase())) {
      throw new ValidationError('La evidencia debe ser una imagen PNG, JPEG o WEBP');
    }

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };

    const aliado = await this.aliadoRepository.findByUsuarioId(user.tenantId, user.userId);
    if (!aliado) {
      throw new ForbiddenError('No existe un perfil de aliado para la cuenta en este tenant');
    }

    const solicitud = await this.solicitudRepository.findById(ctx, solicitudId);
    if (!solicitud) {
      throw new NotFoundError('Solicitud no encontrada');
    }
    if (solicitud.aliadoId !== aliado.id) {
      throw new ForbiddenError('No tienes autorización para registrar eventos en una solicitud asignada a otro aliado');
    }
    if (ESTADOS_CERRADOS.includes(solicitud.estado)) {
      throw new ConflictError(`No es posible registrar eventos en un servicio en estado ${solicitud.estado}`);
    }

    let evidenciaRuta = null;
    if (file) {
      const ruta = `${user.tenantId}/${user.userId}/eventos/${solicitud.id}-${Date.now()}-${nombreSeguro(file.originalname)}`;
      const subida = await this.fileStorageService.upload({ path: ruta, buffer: file.buffer, contentType: file.mimetype });
      evidenciaRuta = subida.path || ruta;
    }

    const evento = await this.eventoServicioRepository.create(ctx, {
      solicitudId: solicitud.id,
      actorId: user.userId,
      tipoEvento: 'EVENTO_EJECUCION',
      descripcion: texto,
      evidenciaRuta,
    });

    return { evento };
  }
}

module.exports = RegisterServiceEventUseCase;
