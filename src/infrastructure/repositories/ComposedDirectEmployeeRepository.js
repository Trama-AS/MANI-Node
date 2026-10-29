const IDirectEmployeeRepository = require('../../domain/ports/IDirectEmployeeRepository');

async function safeRun(action) {
  try {
    await action();
  } catch (err) {
    console.error('[ComposedDirectEmployeeRepository] Falla en compensación:', err?.message || err);
  }
}

/**
 * Registro del empleado directo sobre los repositorios existentes (Supabase o en memoria), para DEV/test sin
 * DATABASE_URL. NO es atómico: compensa a mano (B3, SAGA local) lo ya creado si un paso posterior falla. QA y
 * producción usan PgDirectEmployeeRepository (transacción real).
 */
class ComposedDirectEmployeeRepository extends IDirectEmployeeRepository {
  constructor({ usuarioRepository, aliadoRepository, aliadoCategoriaRepository, documentoKycRepository }) {
    super();
    this.usuarioRepository = usuarioRepository;
    this.aliadoRepository = aliadoRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.documentoKycRepository = documentoKycRepository;
  }

  async registrar({ tenantId }, datos) {
    const { usuarioId } = datos;
    let usuarioCreado = false;
    let aliadoId = null;
    let categoriasCreadas = false;
    try {
      await this.usuarioRepository.create({
        id: usuarioId,
        tenantId,
        email: datos.email,
        rol: 'ALLY',
        estado: 'ACTIVE',
        phone: datos.phone,
      });
      usuarioCreado = true;

      const aliado = await this.aliadoRepository.create({
        tenantId,
        usuarioId,
        tipo: 'EMPLEADO_DIRECTO',
        nombreRazonSocial: datos.fullName,
        estadoVerificacion: 'VERIFIED',
        documentType: datos.documentType,
        documentNumber: datos.documentNumber,
      });
      aliadoId = aliado?.id || usuarioId;

      for (const categoriaId of new Set(datos.categoriaIds)) {
        await this.aliadoCategoriaRepository.create({ tenantId, aliadoId, categoriaId });
        categoriasCreadas = true;
      }

      const [documento] = await this.documentoKycRepository.createMany(tenantId, aliadoId, [
        { ...datos.documento, estado: 'VERIFICADO' },
      ]);
      return { aliadoId, documentoId: documento?.id || null };
    } catch (err) {
      if (categoriasCreadas) await safeRun(() => this.aliadoCategoriaRepository.deleteByAliadoId(tenantId, aliadoId));
      if (aliadoId) await safeRun(() => this.aliadoRepository.deleteByUsuarioId(tenantId, usuarioId));
      if (usuarioCreado) await safeRun(() => this.usuarioRepository.deleteById(tenantId, usuarioId));
      throw err;
    }
  }
}

module.exports = ComposedDirectEmployeeRepository;
