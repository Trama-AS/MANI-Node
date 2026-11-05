const container = require('../container');

// Bandeja de notificaciones del usuario autenticado (HU-M09-06). La sesión la deja `authenticate`.
async function listMyInbox(req, res, next) {
  try {
    const inbox = await container.listMyInboxUseCase.execute({ session: req.user, query: req.query });
    res.status(200).json(inbox);
  } catch (err) {
    next(err);
  }
}

module.exports = { listMyInbox };
