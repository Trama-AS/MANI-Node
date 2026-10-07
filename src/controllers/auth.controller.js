const container = require('../container');

async function registerAllyNaturalPerson(req, res, next) {
  try {
    const result = await container.registerAllyNaturalPersonUseCase.execute({
      tenantId: req.header('X-Tenant-Id'),
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      phone: req.body.phone,
      documentType: req.body.documentType,
      documentNumber: req.body.documentNumber,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { registerAllyNaturalPerson };
