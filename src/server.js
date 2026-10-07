const express = require('express');
const cors = require('cors');
require('dotenv').config();

const healthRoutes = require('./routes/health.routes');
const coreRoutes = require('./routes/core.routes');
const authRoutes = require('./routes/auth.routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Middleware de Trazabilidad: Log y propagación de Correlation ID
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || `node-${Date.now()}`;
  res.setHeader('X-Correlation-ID', correlationId);
  console.log(`[${new Date().toISOString()}] [${req.method}] ${req.originalUrl} - Correlation: ${correlationId}`);
  next();
});

// Rutas
app.use(healthRoutes);
app.use('/api/v1', authRoutes);
app.use('/', authRoutes);
app.use('/api/v1', coreRoutes);
app.use('/', coreRoutes);

// Manejador 404
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada en MANI-Core-Node' });
});

// Inicialización del servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 MANI-Core-Node corriendo en el puerto ${PORT}`);
});
