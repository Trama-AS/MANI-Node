const { Router } = require('express');
const { getMetrics, getContentType } = require('../infrastructure/observability/metrics');

const router = Router();

router.get('/metrics', async (req, res, next) => {
  try {
    const metrics = await getMetrics();
    res.setHeader('Content-Type', getContentType());
    res.status(200).send(metrics);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
