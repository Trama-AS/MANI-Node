const { DomainError } = require('../../../domain/errors/DomainError');

// Un identificador de categoría es un UUID en `categoria_servicio.id`. Se valida
// el formato antes de consultar para no repetir la fuga que QA encontró en
// SCRUM-1391: con `abc` PostgreSQL responde «invalid input syntax for type uuid»
// y ese texto llegaba al cliente (contra T9). Aquí un id con formato inválido no
// es un error del servidor: simplemente no corresponde a ninguna categoría
// disponible, así que se trata como el resto de categorías no disponibles.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Solo un aliado cuya verificación fue aprobada puede declarar las categorías
// que atiende (RF-11, C2 de SCRUM-1392). `estado_verificacion` llega en español
// desde PostgreSQL y en inglés desde el dominio y los repositorios en memoria,
// así que se aceptan las dos grafías, como ya hacen
// ResolveAllyVerificationUseCase y GetOwnAllyProfileUseCase.
const ESTADOS_APROBADOS = new Set(['VERIFIED', 'VERIFICADO']);

/**
 * El aliado declara las categorías de servicio que atiende (US-03.1.3 /
 * HU-M04-03, RF-11).
 *
 * Reemplaza la selección completa: lo que llega es el estado final, no un
 * incremento, para que la pantalla pueda recuperar exactamente lo declarado al
 * recargar (C1).
 *
 * El tenant y el rol salen del claim verificado (T4) y la pertenencia del
 * aliado se comprueba contra ese mismo tenant, así que un aliado no puede
 * declarar ni alterar categorías de otro tenant (C3).
 */
class DeclareAllyCategoriesUseCase {
  constructor({ aliadoRepository, aliadoCategoriaRepository, catalogRepository }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para DeclareAllyCategoriesUseCase');
    }
    if (!aliadoCategoriaRepository) {
      throw new Error('aliadoCategoriaRepository es requerido para DeclareAllyCategoriesUseCase');
    }
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para DeclareAllyCategoriesUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.catalogRepository = catalogRepository;
  }

  async execute({ userId, tenantId, role, categoryIds } = {}) {
    if (!userId || !tenantId) {
      throw new DomainError('MANI-CAT-401: sesión requerida', 'MANI-CAT-401', 401);
    }

    if (role !== 'ALLY') {
      throw new DomainError('MANI-CAT-403: solo un aliado activo puede declarar categorías', 'MANI-CAT-403', 403);
    }

    const aliado = await this.aliadoRepository.findByUsuarioId(tenantId, userId);
    if (!aliado) {
      throw new DomainError('MANI-CAT-403: solo un aliado activo puede declarar categorías', 'MANI-CAT-403', 403);
    }

    // C2: un aliado pendiente o rechazado no declara categorías. Se comprueba
    // antes de validar la lista para no revelar qué categorías existen a quien
    // todavía no está aprobado (T9, fallo cerrado).
    const estado = String(aliado.estado_verificacion ?? aliado.estadoVerificacion ?? '').toUpperCase();
    if (!ESTADOS_APROBADOS.has(estado)) {
      throw new DomainError(
        'MANI-CAT-403: la verificación del aliado debe estar aprobada para declarar categorías',
        'MANI-CAT-403',
        403
      );
    }

    if (!categoryIds || !Array.isArray(categoryIds)) {
      throw new DomainError('MANI-CAT-422V: selecciona al menos una categoría', 'MANI-CAT-422V', 422);
    }

    const cleanIds = [
      ...new Set(categoryIds.filter((id) => typeof id === 'string' && id.trim() !== '')),
    ];

    if (cleanIds.length === 0) {
      throw new DomainError('MANI-CAT-422V: selecciona al menos una categoría', 'MANI-CAT-422V', 422);
    }

    for (const catId of cleanIds) {
      if (!UUID.test(catId.trim())) {
        throw new DomainError('MANI-CAT-422C: categoría no disponible', 'MANI-CAT-422C', 422);
      }

      const category = await this.catalogRepository.findById(tenantId, catId);
      const isActive =
        category &&
        (typeof category.isActive === 'function' ? category.isActive() : category.active !== false);

      if (!category || !isActive) {
        throw new DomainError('MANI-CAT-422C: categoría no disponible', 'MANI-CAT-422C', 422);
      }
    }

    const aliadoId = aliado.id || aliado.usuarioId || userId;
    const saved = await this.aliadoCategoriaRepository.setAliadoCategorias(tenantId, aliadoId, cleanIds, { userId, role });
    return saved;
  }
}

module.exports = DeclareAllyCategoriesUseCase;
