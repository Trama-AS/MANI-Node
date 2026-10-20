const { UnauthorizedError, ForbiddenError } = require('../../../domain/errors/DomainError');

const ADMIN_ROLES = new Set(['ADMIN', 'ADMIN_TENANT']);

function assertAdminSession({ userId, tenantId, role } = {}) {
  if (!userId || !tenantId) {
    throw new UnauthorizedError('MANI-VER-401: sesión requerida', 'MANI-VER-401');
  }
  const normalizedRole = typeof role === 'string' ? role.trim().toUpperCase() : '';
  if (!ADMIN_ROLES.has(normalizedRole)) {
    throw new ForbiddenError(
      'MANI-VER-403: solo el administrador del tenant puede acceder a la bandeja de verificación',
      'MANI-VER-403'
    );
  }
}

function mapEstadoToSpanish(estado) {
  const upper = String(estado || 'PENDIENTE').trim().toUpperCase();
  if (upper === 'VERIFIED' || upper === 'VERIFICADO' || upper === 'APPROVED' || upper === 'APROBADO') {
    return 'VERIFICADO';
  }
  if (upper === 'REJECTED' || upper === 'RECHAZADO') {
    return 'RECHAZADO';
  }
  return 'PENDIENTE';
}

function mapDocumentoKyc(doc) {
  return {
    id: doc.id,
    tipo_documento: doc.tipo_documento || doc.tipoDocumento,
    ruta_storage: doc.ruta_storage || doc.rutaStorage,
    estado: mapEstadoToSpanish(doc.estado),
    fecha_carga: doc.fecha_carga || doc.fechaCarga || doc.created_at || new Date().toISOString(),
  };
}

async function hydrateAllyVerificationView({
  tenantId,
  aliado,
  usuarioRepository,
  aliadoCategoriaRepository,
  catalogRepository,
  documentoKycRepository,
}) {
  const aliadoId = aliado.id || aliado.usuario_id || aliado.usuarioId;
  const usuarioId = aliado.usuario_id || aliado.usuarioId || aliado.id;

  const [usuario, categoriaIds, documentos] = await Promise.all([
    usuarioRepository?.findById ? usuarioRepository.findById(tenantId, usuarioId) : null,
    aliadoCategoriaRepository?.findByAliadoId ? aliadoCategoriaRepository.findByAliadoId(tenantId, aliadoId) : [],
    documentoKycRepository?.findByAliadoId ? documentoKycRepository.findByAliadoId(tenantId, aliadoId) : [],
  ]);

  const categorias = [];
  if (Array.isArray(categoriaIds)) {
    for (const catId of categoriaIds) {
      if (catalogRepository?.findById) {
        const cat = await catalogRepository.findById(tenantId, catId);
        categorias.push(cat?.name || cat?.nombre || catId);
      } else {
        categorias.push(catId);
      }
    }
  }

  return {
    id: aliadoId,
    tipo: aliado.tipo || 'PERSONA_NATURAL',
    nombre: aliado.nombre_razon_social || aliado.nombreRazonSocial || '',
    email: aliado.email || usuario?.email || '',
    estado_verificacion: mapEstadoToSpanish(aliado.estado_verificacion || aliado.estadoVerificacion),
    fecha_registro: aliado.fecha_registro || aliado.fechaRegistro || aliado.created_at || new Date().toISOString(),
    motivo_rechazo: aliado.motivo_rechazo ?? aliado.motivoRechazo ?? null,
    fecha_verificacion: aliado.fecha_verificacion ?? aliado.fechaVerificacion ?? null,
    categorias,
    documentos: (documentos || []).map(mapDocumentoKyc),
  };
}

module.exports = {
  assertAdminSession,
  mapEstadoToSpanish,
  mapDocumentoKyc,
  hydrateAllyVerificationView,
};
