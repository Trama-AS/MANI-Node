const express = require('express');

const correlationId = require('./middlewares/correlationId.middleware');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler.middleware');
const routes = require('./routes');

// CORS lo maneja únicamente MANI-APIGateway (nginx.conf): Core nunca recibe
// peticiones directas de un navegador (AGENTS.md). Si Core también agrega
// Access-Control-Allow-Origin, el navegador recibe el header duplicado
// ("*, *") a través del proxy y rechaza la respuesta entera por CORS,
// aunque el Gateway y Core respondan 200/201 correctamente.
function createApp() {
  const app = express();

  app.use(express.json());
  app.use(correlationId);

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp();
