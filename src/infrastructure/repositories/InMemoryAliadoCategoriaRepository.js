const IAliadoCategoriaRepository = require('../../domain/ports/IAliadoCategoriaRepository');

class InMemoryAliadoCategoriaRepository extends IAliadoCategoriaRepository {
  constructor() {
    super();
    this.rows = [
      {
        id: 'demo-ac-1',
        tenantId: 'trama-demo',
        aliadoId: 'demo-aliado-1',
        categoriaId: 'cat-1',
      },
    ];
  }

  async create(aliadoCategoria) {
    this.rows.push(aliadoCategoria);
    return aliadoCategoria;
  }

  async findByAliadoId(tenantId, aliadoId) {
    return this.rows
      .filter((r) => (!tenantId || r.tenantId === tenantId) && r.aliadoId === aliadoId)
      .map((r) => r.categoriaId);
  }

  async setAliadoCategorias(tenantId, aliadoId, categoriaIds) {
    this.rows = this.rows.filter(
      (r) => !(r.aliadoId === aliadoId && (!tenantId || r.tenantId === tenantId) && !categoriaIds.includes(r.categoriaId))
    );
    for (const catId of categoriaIds) {
      const exists = this.rows.some(
        (r) => r.aliadoId === aliadoId && (!tenantId || r.tenantId === tenantId) && r.categoriaId === catId
      );
      if (!exists) {
        this.rows.push({
          id: `ac-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          tenantId,
          aliadoId,
          categoriaId: catId,
        });
      }
    }
    return this.findByAliadoId(tenantId, aliadoId);
  }

  async deleteByAliadoId(tenantId, aliadoId) {
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.aliadoId === aliadoId));
  }
}

module.exports = InMemoryAliadoCategoriaRepository;
