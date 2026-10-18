const {
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} = require('../../../domain/errors/DomainError');

const PHONE_REGEX = /^\+?[0-9\s()-]{7,20}$/;
const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const PRIVILEGED_FIELDS = [
  'role',
  'rol',
  'status',
  'estado',
  'estadoVerificacion',
  'estado_verificacion',
  'tenantId',
  'tenant_id',
  'id',
  'userId',
  'usuario_id',
  'email',
];

function sanitizeFilename(value) {
  return String(value || 'avatar.png')
    .normalize('NFKD')
    .replace(/[^\w.-]/g, '_');
}

/**
 * US-02.3.1 (SCRUM-854 / SCRUM-1027 / SCRUM-1028):
 * Permite que un usuario autenticado (Cliente o Aliado) actualice únicamente
 * los campos permitidos de su propio perfil (datos personales, teléfono,
 * dirección y foto), prohibiendo cualquier modificación sobre perfiles ajenos
 * o campos privilegiados (rol, estado de verificación, tenantId, id, email).
 */
class UpdateOwnProfileUseCase {
  constructor({ profileRepository, fileStorageService }) {
    if (!profileRepository) {
      throw new Error('profileRepository es requerido para UpdateOwnProfileUseCase');
    }
    this.profileRepository = profileRepository;
    this.fileStorageService = fileStorageService;
  }

  async execute({
    userId,
    tenantId,
    targetUserId = null,
    payload = {},
    photoFile = null,
  } = {}) {
    if (!userId || typeof userId !== 'string' || !userId.trim() || !tenantId) {
      throw new UnauthorizedError('Sesión de usuario autenticado requerida', 'MANI-PRF-401');
    }

    if (targetUserId && targetUserId !== 'me' && targetUserId !== userId) {
      throw new ForbiddenError('No está permitido editar el perfil de otro usuario', 'MANI-PRF-403');
    }

    const rawBody = payload && typeof payload === 'object' ? payload : {};

    for (const field of PRIVILEGED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(rawBody, field) && rawBody[field] !== undefined) {
        throw new ForbiddenError(
          `No está permitido modificar el campo privilegiado "${field}"`,
          'MANI-PRF-403'
        );
      }
    }

    const fullName = rawBody.fullName ?? rawBody.nombre;
    const phone = rawBody.phone ?? rawBody.telefono;
    const address = rawBody.address ?? rawBody.direccion;
    let photoUrl = rawBody.photoUrl ?? rawBody.fotoUrl ?? rawBody.foto_url;

    const changes = {};

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 120) {
        throw new ValidationError(
          'El nombre completo no puede estar vacío y debe tener entre 2 y 120 caracteres',
          'MANI-PRF-422'
        );
      }
      changes.fullName = fullName.trim();
    }

    if (phone !== undefined) {
      const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
      if (!cleanPhone || !PHONE_REGEX.test(cleanPhone)) {
        throw new ValidationError('El formato del teléfono es inválido', 'MANI-PRF-422');
      }
      changes.phone = cleanPhone;
    }

    if (address !== undefined) {
      const cleanAddress = typeof address === 'string' ? address.trim() : '';
      if (!cleanAddress || cleanAddress.length < 5 || cleanAddress.length > 200) {
        throw new ValidationError(
          'La dirección no puede estar vacía y debe tener entre 5 y 200 caracteres',
          'MANI-PRF-422'
        );
      }
      changes.address = cleanAddress;
    }

    if (photoFile) {
      const mime = String(photoFile.contentType || photoFile.mimetype || '').toLowerCase();
      if (!ALLOWED_IMAGE_MIMES.has(mime)) {
        throw new ValidationError(
          `Formato de imagen no soportado: ${mime || 'desconocido'}. Use PNG, JPEG o WEBP`,
          'MANI-PRF-422'
        );
      }
      if (!photoFile.buffer || !photoFile.buffer.length) {
        throw new ValidationError('El archivo de foto de perfil está vacío', 'MANI-PRF-422');
      }
      const path = `${tenantId}/${userId}/avatar-${Date.now()}-${sanitizeFilename(
        photoFile.filename || photoFile.originalname
      )}`;
      if (this.fileStorageService) {
        const uploaded = await this.fileStorageService.upload({
          path,
          buffer: photoFile.buffer,
          contentType: mime,
        });
        photoUrl = uploaded.path || path;
      } else {
        photoUrl = path;
      }
    } else if (photoUrl !== undefined) {
      const cleanUrl = typeof photoUrl === 'string' ? photoUrl.trim() : '';
      if (!cleanUrl || !/\.(png|jpe?g|webp)(\?.*)?$/i.test(cleanUrl)) {
        throw new ValidationError(
          'La foto de perfil debe tener un formato de imagen soportado (.png, .jpg, .jpeg, .webp)',
          'MANI-PRF-422'
        );
      }
      photoUrl = cleanUrl;
    }

    if (photoUrl !== undefined) {
      changes.photoUrl = photoUrl;
    }

    if (Object.keys(changes).length === 0) {
      throw new ValidationError(
        'Debe proporcionar al menos un campo válido para actualizar (fullName, phone, address o photo)',
        'MANI-PRF-422'
      );
    }

    const updatedProfile = await this.profileRepository.updateOwnProfile(userId, tenantId, changes);
    if (!updatedProfile) {
      throw new NotFoundError(`No se encontró un perfil para el usuario ${userId}`, 'MANI-PRF-404');
    }

    return typeof updatedProfile.toJSON === 'function' ? updatedProfile.toJSON() : updatedProfile;
  }
}

module.exports = UpdateOwnProfileUseCase;
