const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

class RegisterServiceEventUseCase {
  constructor({ solicitudRepository, historialSolicitudRepository, fileStorageService = null }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!historialSolicitudRepository) throw new Error('historialSolicitudRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.historialSolicitudRepository = historialSolicitudRepository;
    this.fileStorageService = fileStorageService;
  }

  async execute({ user, solicitudId, observacion, comentario, fotoUrl, file }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo el aliado asignado puede registrar eventos durante la ejecución');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const solicitud = await this.solicitudRepository.findById(solicitudId);
    if (!solicitud || solicitud.tenantId !== user.tenantId) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    if (solicitud.aliadoId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para registrar eventos en una solicitud asignada a otro aliado');
    }

    const estadosInhabilitados = ['FINALIZADA', 'CANCELADA', 'RECHAZADA'];
    if (estadosInhabilitados.includes(solicitud.estado)) {
      throw new ConflictError(
        `No es posible registrar eventos en un servicio en estado ${solicitud.estado}`
      );
    }

    const texto = String(observacion || comentario || '').trim();
    if (!texto || texto.length < 3) {
      throw new ValidationError(
        'El comentario u observación del evento es obligatorio (mínimo 3 caracteres)'
      );
    }
    if (texto.length > 2000) {
      throw new ValidationError('El comentario no puede superar los 2000 caracteres');
    }

    let resolvedFotoUrl = fotoUrl ? String(fotoUrl).trim() : null;

    if (file && this.fileStorageService) {
      const extension = (file.originalname || '').split('.').pop() || 'jpg';
      const path = `${user.tenantId}/${solicitud.id}/eventos/${Date.now()}.${extension}`;
      resolvedFotoUrl = await this.fileStorageService.upload({
        bucket: 'evidencias-servicio',
        path,
        buffer: file.buffer,
        contentType: file.mimetype,
      });
    }

    const evento = await this.historialSolicitudRepository.create({
      solicitudId: solicitud.id,
      usuarioId: user.userId,
      estadoAnterior: solicitud.estado,
      estadoNuevo: solicitud.estado,
      observacion: texto,
      fotoUrl: resolvedFotoUrl,
      fecha: new Date().toISOString(),
    });

    return { evento };
  }
}

module.exports = RegisterServiceEventUseCase;
