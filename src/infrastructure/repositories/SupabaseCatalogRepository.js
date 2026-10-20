const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');
const { DomainError, ConflictError } = require('../../domain/errors/DomainError');

// `categoria_servicio` no tiene columna `descripcion` (ver
// MANI-APIGateway/database/init/01-schema.sql): solo id/tenant_id/nombre/
// estado/flujo_operativo. Category.description queda siempre '' para filas
// que vienen de Supabase hasta que una migración futura agregue esa columna.
const SELECT_COLUMNS = 'id, nombre, estado, flujo_operativo, tenant_id';

// Consultas de administración (US-03.1.2): además, fecha de creación y cuántos
// aliados declaran la categoría (conteo embebido de PostgREST por la única FK
// aliado_categoria.categoria_id). La vitrina pública sigue con SELECT_COLUMNS.
const ADMIN_SELECT_COLUMNS = `${SELECT_COLUMNS}, created_at, aliado_categoria(count)`;

// SQLSTATE de Postgres para violación de restricción UNIQUE (acá,
// ux_categoria_tenant_nombre de MANI-APIGateway/database/migrations/
// 003_categorias_servicio.sql: (tenant_id, lower(btrim(nombre)))).
const UNIQUE_VIOLATION_CODE = '23505';

function toDomain(row) {
  if (!row) return null;
  return new Category({
    id: row.id,
    name: row.nombre,
    active: row.estado === 'ACTIVO',
    tenantId: row.tenant_id,
    // Puede ser una fila histórica (flujo_operativo NULL): Category no aplica
    // reglas de negocio al rehidratar.
    flujoOperativo: row.flujo_operativo,
    createdAt: row.created_at ?? null,
    alliesCount: alliesCountOf(row),
  });
}

// PostgREST devuelve el conteo embebido como `aliado_categoria: [{ count: N }]`.
function alliesCountOf(row) {
  if (!Array.isArray(row.aliado_categoria)) return null;
  return Number(row.aliado_categoria[0]?.count ?? 0);
}

function assertNoError(error, message) {
  if (!error) return;
  if (error.code === UNIQUE_VIOLATION_CODE) {
    throw new ConflictError('Ya existe una categoría con ese nombre en este tenant', 'CATEGORY_NAME_ALREADY_EXISTS');
  }
  throw new DomainError(`${message}: ${error.message}`, 'INTERNAL_ERROR', 500);
}

class SupabaseCatalogRepository extends ICatalogRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findAllCategories() {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('categoria_servicio').select(SELECT_COLUMNS);
    assertNoError(error, 'Error consultando categorías');
    return data.map(toDomain);
  }

  async findActiveByTenant(tenantId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .select(SELECT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('estado', 'ACTIVO')
      .order('nombre', { ascending: true });
    if (error) throw new DomainError(`Error consultando categorías: ${error.message}`, 'INTERNAL_ERROR', 500);
    return (data || []).map(toDomain);
  }

  async findById(tenantId, categoryId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .select(ADMIN_SELECT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .maybeSingle();

    assertNoError(error, 'Error consultando categoría');
    return toDomain(data);
  }

  async findAllByTenant(tenantId, { onlyActive = false } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client.from('categoria_servicio').select(ADMIN_SELECT_COLUMNS).eq('tenant_id', tenantId);
    if (onlyActive) query = query.eq('estado', 'ACTIVO');

    const { data, error } = await query;
    assertNoError(error, 'Error consultando categorías del tenant');
    return data.map(toDomain);
  }

  async create(tenantId, { name, flujoOperativo }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .insert({ tenant_id: tenantId, nombre: name, estado: 'ACTIVO', flujo_operativo: flujoOperativo })
      .select(ADMIN_SELECT_COLUMNS)
      .single();

    assertNoError(error, 'Error creando categoría');
    return toDomain(data);
  }

  async update(tenantId, categoryId, { name, flujoOperativo }) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {};
    if (name !== undefined) payload.nombre = name;
    if (flujoOperativo !== undefined) payload.flujo_operativo = flujoOperativo;

    const { data, error } = await client
      .from('categoria_servicio')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .select(ADMIN_SELECT_COLUMNS)
      .maybeSingle();

    assertNoError(error, 'Error actualizando categoría');
    return toDomain(data);
  }

  async setActive(tenantId, categoryId, active) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .update({ estado: active ? 'ACTIVO' : 'INACTIVO' })
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .select(ADMIN_SELECT_COLUMNS)
      .maybeSingle();

    assertNoError(error, 'Error actualizando el estado de la categoría');
    return toDomain(data);
  }
}

module.exports = SupabaseCatalogRepository;
