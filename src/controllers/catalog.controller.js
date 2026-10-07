const container = require('../container');

async function listCategories(req, res, next) {
  try {
    const categories = await container.listCatalogCategoriesUseCase.execute();
    res.status(200).json({ categories });
  } catch (err) {
    next(err);
  }
}

module.exports = { listCategories };

