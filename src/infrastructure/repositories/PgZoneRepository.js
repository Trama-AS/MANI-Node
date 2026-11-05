const IZoneRepository = require('../../domain/ports/IZoneRepository');
const Zone = require('../../domain/entities/Zone');
const { DomainError } = require('../../domain/errors/DomainError');

/**
 * Catálogo geográfico leído por `pg` (DATABASE_URL) como `mani_core_svc`. Es el
 * único lector de zonas con base: desde SCRUM-1468 Core ya no lee tablas con la
 * clave service_role de Supabase, que saltaba RLS.
 *
 * `zona` es un catálogo global sin tenant_id, así que no se abre contexto de
 * tenant: la autorización vive en el borde HTTP (T4/T7), igual que documenta
 * ListZoneCatalogUseCase. Solo lee.
 */

// Columnas reales de `zona` en MANI-APIGateway/database/init/01-schema.sql.
const SELECT_COLUMNS = 'id, nivel, nombre, zona_padre_id, estado';

// El seed de QA escribe 'ACTIVO'; el repositorio de solicitudes acepta además
// 'ACTIVA'. Se normaliza igual acá para que ambas formas cuenten como activa.
const ACTIVE_STATES = ['ACTIVO', 'ACTIVA'];

// Columnas de `geometria_territorial` (migración 0036). La procedencia y la
// atribución viajan con el dato porque la licencia de la fuente obliga a
// acreditarla en la interfaz que muestre los límites.
const GEOMETRY_COLUMNS =
  'zona_id, geometria, fuente, codigo_fuente, licencia, atribucion, fuente_fecha, actualizado_en';

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

function toGeometry(row) {
  return {
    zoneId: row.zona_id,
    geometry: row.geometria,
    source: row.fuente,
    sourceCode: row.codigo_fuente ?? null,
    licence: row.licencia,
    attribution: row.atribucion,
    sourceDate: row.fuente_fecha ?? null,
    updatedAt: row.actualizado_en,
  };
}

class PgZoneRepository extends IZoneRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgZoneRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  #pool() {
    const pool = this.pgPoolFactory.getPool();
    if (!pool) {
      // Falla cerrado: sin base no se devuelve un catálogo vacío, que el
      // cliente no podría distinguir de «no hay zonas» (criterio T9).
      throw new DomainError(
        'MANI-ZON-503: la base de datos no está configurada (DATABASE_URL)',
        'SERVICE_UNAVAILABLE',
        503
      );
    }
    return pool;
  }

  async findAll({ onlyActive = false } = {}) {
    // El filtro va en la consulta y no en memoria: así la base nunca envía
    // filas de más. El orden es el mismo que el del repositorio de Supabase.
    const { rows } = await this.#pool().query(
      `SELECT ${SELECT_COLUMNS} FROM zona
        ${onlyActive ? 'WHERE upper(btrim(estado)) = ANY($1::text[])' : ''}
        ORDER BY nivel, nombre`,
      onlyActive ? [ACTIVE_STATES] : []
    );
    return rows.map(toDomain);
  }

  async findById(zoneId) {
    const { rows } = await this.#pool().query(`SELECT ${SELECT_COLUMNS} FROM zona WHERE id = $1`, [zoneId]);
    return toDomain(rows[0] ?? null);
  }

  async findGeometriesByZoneIds(zoneIds) {
    if (!Array.isArray(zoneIds) || zoneIds.length === 0) return [];
    const { rows } = await this.#pool().query(
      `SELECT ${GEOMETRY_COLUMNS} FROM geometria_territorial WHERE zona_id = ANY($1::uuid[])`,
      [zoneIds]
    );
    return rows.map(toGeometry);
  }
}

module.exports = PgZoneRepository;
