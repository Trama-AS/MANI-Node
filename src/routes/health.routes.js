const { Router } = require('express');

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'MANI-Core-Node',
    timestamp: new Date().toISOString(),
    correlationId: req.headers['x-correlation-id'] || 'none',
  });
});

module.exports = router;
