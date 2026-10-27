const IZoneRepository = require('../../domain/ports/IZoneRepository');
const Zone = require('../../domain/entities/Zone');
const { DomainError } = require('../../domain/errors/DomainError');

// Columnas reales de `zona` en MANI-APIGateway/database/init/01-schema.sql:
// id, nivel, nombre, zona_padre_id, estado. No hay tenant_id ni geometría.
const SELECT_COLUMNS = 'id, nivel, nombre, zona_padre_id, estado';

// El seed de QA escribe 'ACTIVO'; el repositorio de solicitudes acepta además
// 'ACTIVA' (ver PgServiceRequestRepository). Se normaliza igual acá para que
// una fila con cualquiera de las dos formas cuente como activa.
const ACTIVE_STATES = ['ACTIVO', 'ACTIVA'];

function isActiveState(estado) {
  return ACTIVE_STATES.includes(String(estado ?? '').trim().toUpperCase());
}

function toDomain(row) {
  if (!row) return null;
  return new Zone({
    id: row.id,
    name: row.nombre,
    level: row.nivel,
    parentId: row.zona_padre_id,
    active: isActiveState(row.estado),
  });
}

function assertNoError(error, message) {
  if (!error) return;
  throw new DomainError(`${message}: ${error.message}`, 'INTERNAL_ERROR', 500);
}

class SupabaseZoneRepository extends IZoneRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findAll({ onlyActive = false } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client.from('zona').select(SELECT_COLUMNS).order('nivel').order('nombre');
    // El filtro va en la consulta, no en memoria (mismo criterio que el
    // catálogo de categorías): así la base nunca envía filas de más.
    if (onlyActive) {
      query = query.in('estado', ACTIVE_STATES);
    }
    const { data, error } = await query;
    assertNoError(error, 'Error consultando zonas');
    return data.map(toDomain);
  }

  async findById(zoneId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('zona').select(SELECT_COLUMNS).eq('id', zoneId).maybeSingle();
    assertNoError(error, 'Error consultando la zona');
    return toDomain(data);
  }
}

module.exports = SupabaseZoneRepository;
