const container = require('../container');

async function getHealth(req, res, next) {
  try {
    const result = await container.checkHealthUseCase.execute();
    const httpStatus = result.status === 'UP' ? 200 : 503;

    res.status(httpStatus).json({
      ...result,
      correlationId: req.correlationId || 'none',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getHealth };
