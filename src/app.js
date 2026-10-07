const express = require('express');
const cors = require('cors');

const correlationId = require('./middlewares/correlationId.middleware');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler.middleware');
const routes = require('./routes');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(correlationId);

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp();
