function getHealth(req, res) {
  res.status(200).json({
    status: 'UP',
    service: 'MANI-Core-Node',
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId || 'none',
  });
}

module.exports = { getHealth };
