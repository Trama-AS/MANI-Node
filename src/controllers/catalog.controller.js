const container = require('../container');

async function listCategories(req, res, next) {
  try {
    const categories = await container.listCatalogCategoriesUseCase.execute();
    res.status(200).json({ categories });
  } catch (err) {
    next(err);
  }
}

async function listCategoriesForTenant(req, res, next) {
  try {
    const onlyActive = req.query.onlyActive === 'true';
    const categories = await container.listCategoriesForTenantUseCase.execute({
      tenantId: req.tenantId,
      onlyActive,
    });
    res.status(200).json({ categories });
  } catch (err) {
    next(err);
  }
}

async function getCategory(req, res, next) {
  try {
    const category = await container.getCategoryUseCase.execute({
      tenantId: req.tenantId,
      categoryId: req.params.id,
    });
    res.status(200).json({ category });
  } catch (err) {
    next(err);
  }
}

async function createCategory(req, res, next) {
  try {
    const { name, description } = req.body;
    const category = await container.createCategoryUseCase.execute({
      tenantId: req.tenantId,
      name,
      description,
    });
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
}

async function updateCategory(req, res, next) {
  try {
    const { name, description } = req.body;
    const category = await container.updateCategoryUseCase.execute({
      tenantId: req.tenantId,
      categoryId: req.params.id,
      name,
      description,
    });
    res.status(200).json({ category });
  } catch (err) {
    next(err);
  }
}

async function activateCategory(req, res, next) {
  try {
    const category = await container.setCategoryStatusUseCase.execute({
      tenantId: req.tenantId,
      categoryId: req.params.id,
      active: true,
    });
    res.status(200).json({ category });
  } catch (err) {
    next(err);
  }
}

async function deactivateCategory(req, res, next) {
  try {
    const category = await container.setCategoryStatusUseCase.execute({
      tenantId: req.tenantId,
      categoryId: req.params.id,
      active: false,
    });
    res.status(200).json({ category });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCategories,
  listCategoriesForTenant,
  getCategory,
  createCategory,
  updateCategory,
  activateCategory,
  deactivateCategory,
};
