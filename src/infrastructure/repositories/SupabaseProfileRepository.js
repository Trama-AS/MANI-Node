const IProfileRepository = require('../../domain/ports/IProfileRepository');
const Profile = require('../../domain/entities/Profile');
const { DomainError } = require('../../domain/errors/DomainError');
const { ROL_FROM_DB, ESTADO_VERIFICACION_FROM_DB } = require('./supabaseEnumMaps');

/**
 * Migra la lectura de perfil a una consulta real contra `usuario` (+ `aliado`
 * cuando el rol es ALLY, para nombre_razon_social/estado_verificacion). Antes
 * de esto, container.js usaba InMemoryProfileRepository en TODOS los
 * ambientes y su fallback devolvía el perfil demo para cualquier userId sin
 * filtrar por tenant (B4) — con esto, un userId/tenant que no coincide da
 * null (-> 404 en GetOwnProfileUseCase), nunca datos de otro usuario.
 */
class SupabaseProfileRepository extends IProfileRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findByUserId(userId, tenantId = null) {
    const client = this.supabaseClientFactory.getClient();

    let query = client.from('usuario').select('id, tenant_id, email, rol, estado').eq('id', userId);
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data: usuario, error } = await query.maybeSingle();
    if (error) throw new DomainError(`Error consultando perfil: ${error.message}`, 'INTERNAL_ERROR', 500);
    if (!usuario) return null;

    const role = ROL_FROM_DB[usuario.rol] || usuario.rol;
    let fullName = usuario.email;
    let status = 'VERIFIED';

    if (role === 'ALLY') {
      const { data: aliado, error: aliadoError } = await client
        .from('aliado')
        .select('nombre_razon_social, estado_verificacion')
        .eq('usuario_id', usuario.id)
        .maybeSingle();
      if (aliadoError) throw new DomainError(`Error consultando aliado: ${aliadoError.message}`, 'INTERNAL_ERROR', 500);
      if (aliado) {
        fullName = aliado.nombre_razon_social;
        status = ESTADO_VERIFICACION_FROM_DB[aliado.estado_verificacion] || 'PENDING';
      }
    }

    return new Profile({ id: usuario.id, userId: usuario.id, role, fullName, status, tenantId: usuario.tenant_id });
  }

  async updateOwnProfile(userId, tenantId, changes = {}) {
    const current = await this.findByUserId(userId, tenantId);
    if (!current) return null;

    const client = this.supabaseClientFactory.getClient();
    const usuarioUpdates = {};
    if (changes.phone !== undefined) usuarioUpdates.telefono = changes.phone;
    if (changes.address !== undefined) usuarioUpdates.direccion = changes.address;
    if (changes.photoUrl !== undefined) usuarioUpdates.foto_url = changes.photoUrl;

    if (Object.keys(usuarioUpdates).length > 0) {
      const { error } = await client
        .from('usuario')
        .update(usuarioUpdates)
        .eq('id', userId)
        .eq('tenant_id', tenantId);
      if (error) throw new DomainError(`Error actualizando usuario: ${error.message}`, 'INTERNAL_ERROR', 500);
    }

    if (changes.fullName !== undefined && current.role === 'ALLY') {
      const { error: aliadoErr } = await client
        .from('aliado')
        .update({ nombre_razon_social: changes.fullName })
        .eq('usuario_id', userId)
        .eq('tenant_id', tenantId);
      if (aliadoErr) throw new DomainError(`Error actualizando aliado: ${aliadoErr.message}`, 'INTERNAL_ERROR', 500);
    }

    return new Profile({
      id: current.id,
      userId: current.userId,
      role: current.role,
      fullName: changes.fullName !== undefined ? changes.fullName : current.fullName,
      status: current.status,
      tenantId: current.tenantId,
      phone: changes.phone !== undefined ? changes.phone : current.phone,
      address: changes.address !== undefined ? changes.address : current.address,
      photoUrl: changes.photoUrl !== undefined ? changes.photoUrl : current.photoUrl,
    });
  }
}

module.exports = SupabaseProfileRepository;

