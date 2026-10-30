const ITariffRepository = require('../../domain/ports/ITariffRepository');
const { ConflictError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { solicitudVisible } = require('./sesionActores');

const COLUMNAS = `t.id, t.categoria_id, c.nombre AS categoria_nombre, t.valor_min, t.valor_tipico, t.valor_max, t.moneda,
  to_char(t.vigencia_desde, 'YYYY-MM-DD') AS vigencia_desde, to_char(t.vigencia_hasta, 'YYYY-MM-DD') AS vigencia_hasta,
  t.condiciones, t.version, t.estado, t.reemplaza_id, t.creado_por, t.actor_rol, t.correlation_id, t.created_at`;

function toTarifa(row) {
  return {
    id: row.id,
    categoriaId: row.categoria_id,
    categoriaNombre: row.categoria_nombre,
    valorMin: Number(row.valor_min),
    valorTipico: Number(row.valor_tipico),
    valorMax: Number(row.valor_max),
    moneda: row.moneda,
    vigenciaDesde: row.vigencia_desde,
    vigenciaHasta: row.vigencia_hasta,
    condiciones: row.condiciones,
    version: row.version,
    estado: row.estado,
    reemplazaId: row.reemplaza_id,
    auditoria: { creadoPor: row.creado_por, actorRol: row.actor_rol, correlationId: row.correlation_id, creadaEn: row.created_at },
  };
}

// Lo que ven el cliente y el aliado (SCRUM-886): sin auditoría ni identificadores internos de quien la cargó.
const CAMPOS_REFERENCIA = ['id', 'categoriaId', 'categoriaNombre', 'valorMin', 'valorTipico', 'valorMax', 'moneda',
  'vigenciaDesde', 'vigenciaHasta', 'condiciones', 'version'];

function toReferencia(row) {
  const tarifa = toTarifa(row);
  return Object.fromEntries(CAMPOS_REFERENCIA.map((campo) => [campo, tarifa[campo]]));
}

const categoriaNoEncontrada = () =>
  new NotFoundError('MANI-TAR-404C: la categoría no existe en el tenant', 'MANI-TAR-404C');
const tarifaNoEncontrada = () => new NotFoundError('MANI-TAR-404: tarifa no encontrada', 'MANI-TAR-404');
const solicitudNoEncontrada = () => new NotFoundError('MANI-TAR-404S: solicitud no encontrada', 'MANI-TAR-404S');

// 23P01 = exclusion_violation: otra tarifa ACTIVA de la categoría cubre parte de la vigencia (ex_tarifa_referencia_vigencia_activa).
function traducirConflicto(err) {
  if (err && err.code === '23P01') {
    return new ConflictError(
      'MANI-TAR-409V: la vigencia se cruza con otra tarifa activa de la categoría; edítala en lugar de crear otra',
      'MANI-TAR-409V'
    );
  }
  return err;
}

/**
 * Tarifario de referencia sobre `pg` con withTenantContext (ADR-0032): toda consulta filtra por el tenant del JWT
 * además de RLS. Una versión nunca se sobrescribe (migración 0029): editar marca la anterior REEMPLAZADA y crea la
 * siguiente en la misma transacción, así que un error deja intacta la tarifa vigente (C2 de SCRUM-885).
 */
class PgTariffRepository extends ITariffRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgTariffRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async crear(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const categoria = await client.query(
        'SELECT id FROM categoria_servicio WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [datos.categoriaId, ctx.tenantId]
      );
      if (categoria.rows.length === 0) throw categoriaNoEncontrada();
      return this._insertar(client, ctx, datos, null);
    }).catch((err) => {
      throw traducirConflicto(err);
    });
  }

  async reemplazar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const actual = await client.query(
        'SELECT id, categoria_id, estado FROM tarifa_referencia WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [datos.tarifaId, ctx.tenantId]
      );
      if (actual.rows.length === 0) throw tarifaNoEncontrada();
      if (actual.rows[0].estado !== 'ACTIVA') {
        throw new ConflictError(
          'MANI-TAR-409R: esa versión ya fue reemplazada; edita la versión activa de la categoría',
          'MANI-TAR-409R'
        );
      }
      // La categoría se bloquea para que dos ediciones simultáneas no tomen el mismo número de versión.
      await client.query('SELECT id FROM categoria_servicio WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [
        actual.rows[0].categoria_id,
        ctx.tenantId,
      ]);
      await client.query("UPDATE tarifa_referencia SET estado = 'REEMPLAZADA' WHERE id = $1 AND tenant_id = $2", [
        datos.tarifaId,
        ctx.tenantId,
      ]);
      return this._insertar(client, ctx, { ...datos, categoriaId: actual.rows[0].categoria_id }, datos.tarifaId);
    }).catch((err) => {
      throw traducirConflicto(err);
    });
  }

  async _insertar(client, ctx, datos, reemplazaId) {
    const { rows } = await client.query(
      `WITH nueva AS (
         INSERT INTO tarifa_referencia (tenant_id, categoria_id, valor_min, valor_tipico, valor_max, moneda, vigencia_desde,
           vigencia_hasta, condiciones, version, estado, reemplaza_id, creado_por, actor_rol, correlation_id)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9,
           coalesce((SELECT max(version) FROM tarifa_referencia WHERE tenant_id = $1 AND categoria_id = $2), 0) + 1,
           'ACTIVA', $10, $11, $12, $13
         RETURNING *
       )
       SELECT ${COLUMNAS} FROM nueva t JOIN categoria_servicio c ON c.id = t.categoria_id AND c.tenant_id = t.tenant_id`,
      [
        ctx.tenantId,
        datos.categoriaId,
        datos.valorMin,
        datos.valorTipico,
        datos.valorMax,
        datos.moneda,
        datos.vigenciaDesde,
        datos.vigenciaHasta,
        datos.condiciones,
        reemplazaId,
        ctx.userId,
        ctx.role,
        datos.correlationId,
      ]
    );
    return toTarifa(rows[0]);
  }

  async listarActivas(ctx, { categoriaId }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNAS}
         FROM tarifa_referencia t JOIN categoria_servicio c ON c.id = t.categoria_id AND c.tenant_id = t.tenant_id
         WHERE t.tenant_id = $1 AND t.estado = 'ACTIVA' AND ($2::uuid IS NULL OR t.categoria_id = $2)
         ORDER BY c.nombre, t.vigencia_desde`,
        [ctx.tenantId, categoriaId]
      );
      return rows.map(toTarifa);
    });
  }

  async historial(ctx, { categoriaId }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const categoria = await client.query('SELECT id FROM categoria_servicio WHERE id = $1 AND tenant_id = $2', [
        categoriaId,
        ctx.tenantId,
      ]);
      if (categoria.rows.length === 0) throw categoriaNoEncontrada();
      const { rows } = await client.query(
        `SELECT ${COLUMNAS}
         FROM tarifa_referencia t JOIN categoria_servicio c ON c.id = t.categoria_id AND c.tenant_id = t.tenant_id
         WHERE t.tenant_id = $1 AND t.categoria_id = $2
         ORDER BY t.version DESC`,
        [ctx.tenantId, categoriaId]
      );
      return rows.map(toTarifa);
    });
  }

  async vigenteParaSolicitud(ctx, { solicitudId, fecha }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      // El cliente dueño y el aliado asignado; el administrador, cualquier solicitud de su tenant.
      if (ctx.role === 'ADMIN') {
        const s = await client.query('SELECT 1 FROM solicitud WHERE id = $1 AND tenant_id = $2', [solicitudId, ctx.tenantId]);
        if (s.rows.length === 0) throw solicitudNoEncontrada();
      } else {
        await solicitudVisible(client, ctx, solicitudId, solicitudNoEncontrada);
      }
      const { rows } = await client.query(
        `SELECT ${COLUMNAS}
         FROM solicitud s
         JOIN tarifa_referencia t ON t.tenant_id = s.tenant_id AND t.categoria_id = s.categoria_id
         JOIN categoria_servicio c ON c.id = t.categoria_id AND c.tenant_id = t.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2 AND t.estado = 'ACTIVA'
           AND t.vigencia_desde <= $3::date AND (t.vigencia_hasta IS NULL OR t.vigencia_hasta >= $3::date)
         LIMIT 1`,
        [solicitudId, ctx.tenantId, fecha]
      );
      // C2 de SCRUM-886: sin tarifa vigente se dice que no hay referencia; nunca se inventa un valor.
      return rows.length ? { disponible: true, tarifa: toReferencia(rows[0]) } : { disponible: false, tarifa: null };
    });
  }

  async cotizacionesConTarifa(ctx, { desde, hasta }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      // La tarifa que regía cuando se emitió la cotización: la versión creada antes de la cotización, que aún no había
      // sido reemplazada en ese momento y cuya vigencia cubría la fecha (en Colombia) de la cotización.
      const { rows } = await client.query(
        `SELECT cot.id, cot.solicitud_id, cot.version AS cotizacion_version, cot.estado, cot.created_at,
                (cot.valor_mano_obra + cot.valor_materiales) AS total,
                s.categoria_id, c.nombre AS categoria_nombre, a.id AS aliado_id, a.nombre_razon_social AS aliado_nombre,
                t.id AS tarifa_id, t.version AS tarifa_version, t.valor_min, t.valor_tipico, t.valor_max, t.moneda
         FROM cotizacion cot
         JOIN solicitud s ON s.id = cot.solicitud_id AND s.tenant_id = cot.tenant_id
         JOIN categoria_servicio c ON c.id = s.categoria_id AND c.tenant_id = s.tenant_id
         JOIN aliado a ON a.id = cot.aliado_id AND a.tenant_id = cot.tenant_id
         LEFT JOIN LATERAL (
           SELECT tr.* FROM tarifa_referencia tr
           WHERE tr.tenant_id = cot.tenant_id AND tr.categoria_id = s.categoria_id
             AND tr.created_at <= cot.created_at
             AND tr.vigencia_desde <= (cot.created_at AT TIME ZONE 'America/Bogota')::date
             AND (tr.vigencia_hasta IS NULL OR tr.vigencia_hasta >= (cot.created_at AT TIME ZONE 'America/Bogota')::date)
             AND NOT EXISTS (
               SELECT 1 FROM tarifa_referencia sig
               WHERE sig.reemplaza_id = tr.id AND sig.tenant_id = tr.tenant_id AND sig.created_at <= cot.created_at
             )
           ORDER BY tr.version DESC LIMIT 1
         ) t ON true
         WHERE cot.tenant_id = $1
           AND cot.created_at >= ($2::date::timestamp AT TIME ZONE 'America/Bogota')
           AND cot.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Bogota')
         ORDER BY cot.created_at DESC, cot.id`,
        [ctx.tenantId, desde, hasta]
      );
      return rows.map((r) => ({
        id: r.id,
        solicitudId: r.solicitud_id,
        version: r.cotizacion_version,
        estado: r.estado,
        creadaEn: r.created_at,
        total: Math.round(Number(r.total) * 100) / 100,
        categoria: { id: r.categoria_id, nombre: r.categoria_nombre },
        aliado: { id: r.aliado_id, nombre: r.aliado_nombre },
        tarifa: r.tarifa_id
          ? {
              id: r.tarifa_id,
              version: r.tarifa_version,
              valorMin: Number(r.valor_min),
              valorTipico: Number(r.valor_tipico),
              valorMax: Number(r.valor_max),
              moneda: r.moneda,
            }
          : null,
      }));
    });
  }
}

module.exports = PgTariffRepository;
