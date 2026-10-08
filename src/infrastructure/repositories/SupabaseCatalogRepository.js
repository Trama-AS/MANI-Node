const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');
const { DomainError, ConflictError } = require('../../domain/errors/DomainError');

// `categoria_servicio` no tiene columna `descripcion` (ver
// MANI-APIGateway/database/init/01-schema.sql): solo id/tenant_id/nombre/
// estado/flujo_operativo. Category.description queda siempre '' para filas
// que vienen de Supabase hasta que una migración futura agregue esa columna.
const SELECT_COLUMNS = 'id, nombre, estado, flujo_operativo, tenant_id';

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
    flujoOperativo: row.flujo_operativo,
    // Esta fila viene de una SELECT (incluida la que devuelven create/update
    // tras el INSERT/UPDATE): puede ser una categoría de seed anterior a
    // US-03.1.1-M2.1 con flujo_operativo NULL. No volver a exigir el enum
    // aquí; CreateCategoryUseCase/UpdateCategoryUseCase ya lo validaron
    // antes de llegar al repositorio cuando el dato es realmente nuevo.
    fromPersistence: true,
  });
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

  async findById(tenantId, categoryId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .select(SELECT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .maybeSingle();

    assertNoError(error, 'Error consultando categoría');
    return toDomain(data);
  }

  async findAllByTenant(tenantId, { onlyActive = false } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client.from('categoria_servicio').select(SELECT_COLUMNS).eq('tenant_id', tenantId);
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
      .select(SELECT_COLUMNS)
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
      .select(SELECT_COLUMNS)
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
      .select(SELECT_COLUMNS)
      .maybeSingle();

    assertNoError(error, 'Error actualizando el estado de la categoría');
    return toDomain(data);
  }
}

module.exports = SupabaseCatalogRepository;
