const container = require('../container');

// Superficie interna que consume MANI-Dispatch (ADR-0030). La sesión la deja `authenticate` a partir del JWT
// que Dispatch reenvía; el tenant y el rol nunca se leen de cabeceras ni del cuerpo.

async function listEligibleAllies(req, res, next) {
  try {
    const result = await container.listEligibleAlliesUseCase.execute({ session: req.user, query: req.query });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function getSolicitudContext(req, res, next) {
  try {
    const context = await container.getSolicitudContextUseCase.execute({ session: req.user, solicitudId: req.params.id });
    res.status(200).json(context);
  } catch (err) {
    next(err);
  }
}

async function publishNotification(req, res, next) {
  try {
    const created = await container.publishNotificationUseCase.execute({ session: req.user, body: req.body });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

async function getOwnAllyProfile(req, res, next) {
  try {
    const profile = await container.getOwnAllyProfileUseCase.execute({ session: req.user });
    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
}

async function listNotifications(req, res, next) {
  try {
    const offers = await container.listNotificationsUseCase.execute({ session: req.user, query: req.query });
    res.status(200).json(offers);
  } catch (err) {
    next(err);
  }
}

module.exports = { listEligibleAllies, getSolicitudContext, getOwnAllyProfile, publishNotification, listNotifications };
