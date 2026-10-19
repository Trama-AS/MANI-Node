const IAliadoAusenciaRepository = require('../../domain/ports/IAliadoAusenciaRepository');
const AllyAbsence = require('../../domain/entities/AllyAbsence');
const { DomainError } = require('../../domain/errors/DomainError');

const COLUMNS = 'id, tenant_id, aliado_id, inicio, fin, motivo, nota';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toEntity(row) {
  return new AllyAbsence({
    id: row.id,
    tenantId: row.tenant_id,
    aliadoId: row.aliado_id,
    startsAt: new Date(row.inicio),
    endsAt: new Date(row.fin),
    reason: row.motivo,
    note: row.nota,
  });
}

function toRow(absence) {
  return {
    tenant_id: absence.tenantId,
    aliado_id: absence.aliadoId,
    inicio: absence.startsAt.toISOString(),
    fin: absence.endsAt.toISOString(),
    motivo: absence.reason,
    nota: absence.note,
  };
}

/**
 * Persistencia de aliado_ausencia (MANI-APIGateway/database/migrations/008_add_aliado_ausencia.sql).
 * Cada consulta filtra por tenant_id y aliado_id: la service role salta RLS,
 * así que el aislamiento lo garantiza este repositorio.
 */
class SupabaseAliadoAusenciaRepository extends IAliadoAusenciaRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findByAliadoId(tenantId, aliadoId, from = new Date()) {
    const { data, error } = await this.supabaseClientFactory
      .getClient()
      .from('aliado_ausencia')
      .select(COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('aliado_id', aliadoId)
      .gt('fin', from.toISOString())
      .order('inicio', { ascending: true });

    if (error) throw this.mapError(error, 'Error consultando las ausencias del aliado');
    return (data || []).map(toEntity);
  }

  async findById(tenantId, aliadoId, id) {
    // Un id que no es UUID no puede existir; se evita el error 22P02 de PostgreSQL.
    if (!UUID_RE.test(String(id))) return null;

    const { data, error } = await this.supabaseClientFactory
      .getClient()
      .from('aliado_ausencia')
      .select(COLUMNS)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('aliado_id', aliadoId)
      .maybeSingle();

    if (error) throw this.mapError(error, 'Error consultando la ausencia del aliado');
    return data ? toEntity(data) : null;
  }

  async findOverlapping(tenantId, aliadoId, startsAt, endsAt, excludeId = null) {
    let query = this.supabaseClientFactory
      .getClient()
      .from('aliado_ausencia')
      .select(COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('aliado_id', aliadoId)
      .lt('inicio', endsAt.toISOString())
      .gt('fin', startsAt.toISOString());
    if (excludeId) query = query.neq('id', excludeId);

    const { data, error } = await query;
    if (error) throw this.mapError(error, 'Error validando el solapamiento de ausencias');
    return (data || []).map(toEntity);
  }

  async create(absence) {
    const { data, error } = await this.supabaseClientFactory
      .getClient()
      .from('aliado_ausencia')
      .insert(toRow(absence))
      .select(COLUMNS)
      .single();

    if (error) throw this.mapError(error, 'Error registrando la ausencia del aliado');
    return toEntity(data);
  }

  async update(absence) {
    const { data, error } = await this.supabaseClientFactory
      .getClient()
      .from('aliado_ausencia')
      .update({ ...toRow(absence), updated_at: new Date().toISOString() })
      .eq('id', absence.id)
      .eq('tenant_id', absence.tenantId)
      .eq('aliado_id', absence.aliadoId)
      .select(COLUMNS)
      .maybeSingle();

    if (error) throw this.mapError(error, 'Error actualizando la ausencia del aliado');
    return data ? toEntity(data) : null;
  }

  async delete(tenantId, aliadoId, id) {
    if (!UUID_RE.test(String(id))) return false;

    const { data, error } = await this.supabaseClientFactory
      .getClient()
      .from('aliado_ausencia')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .eq('aliado_id', aliadoId)
      .select('id');

    if (error) throw this.mapError(error, 'Error eliminando la ausencia del aliado');
    return (data || []).length > 0;
  }

  /** Las restricciones de la tabla se traducen a los mismos errores de negocio del caso de uso. */
  mapError(error, message) {
    if (error.code === '23P01') {
      return new DomainError('MANI-AUS-409: el intervalo se cruza con otra ausencia registrada', 'MANI-AUS-409', 409);
    }
    if (error.code === '23514') {
      return new DomainError('MANI-AUS-422H: horario de ausencia inválido', 'MANI-AUS-422H', 422);
    }
    // fk_aliado_ausencia_aliado_tenant: el aliado no existe en ese tenant.
    if (error.code === '23503') {
      return new DomainError('MANI-AUS-403: solo un aliado puede gestionar su disponibilidad', 'MANI-AUS-403', 403);
    }
    return new DomainError(`${message}: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

module.exports = SupabaseAliadoAusenciaRepository;
