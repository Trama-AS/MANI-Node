const container = require('../container');

function requireAuthorization(req, res) {
  if (req.headers.authorization) return true;
  res.status(401).json({
    error: 'Encabezado Authorization requerido',
    correlationId: req.correlationId || 'none',
  });
  return false;
}

async function resolveSession(req) {
  const session = req.user || (await container.tokenService.verifyToken(req.headers.authorization));
  return { userId: session.userId, tenantId: session.tenantId, role: session.role };
}

function absenceFields(body = {}) {
  return {
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    reason: body.reason,
    note: body.note,
  };
}

async function listAbsences(req, res, next) {
  if (!requireAuthorization(req, res)) return;
  try {
    const { absences, availableNow } = await container.listAllyAbsencesUseCase.execute(await resolveSession(req));
    res.status(200).json({
      message: 'Ausencias vigentes y futuras del aliado',
      correlationId: req.correlationId || 'none',
      availableNow,
      data: absences,
    });
  } catch (err) {
    next(err);
  }
}

async function createAbsence(req, res, next) {
  if (!requireAuthorization(req, res)) return;
  try {
    const absence = await container.createAllyAbsenceUseCase.execute({
      ...(await resolveSession(req)),
      ...absenceFields(req.body),
    });
    res.status(201).json({
      message: 'Ausencia registrada',
      correlationId: req.correlationId || 'none',
      data: absence,
    });
  } catch (err) {
    next(err);
  }
}

async function updateAbsence(req, res, next) {
  if (!requireAuthorization(req, res)) return;
  try {
    const absence = await container.updateAllyAbsenceUseCase.execute({
      ...(await resolveSession(req)),
      absenceId: req.params.absenceId,
      ...absenceFields(req.body),
    });
    res.status(200).json({
      message: 'Ausencia actualizada',
      correlationId: req.correlationId || 'none',
      data: absence,
    });
  } catch (err) {
    next(err);
  }
}

async function deleteAbsence(req, res, next) {
  if (!requireAuthorization(req, res)) return;
  try {
    await container.deleteAllyAbsenceUseCase.execute({
      ...(await resolveSession(req)),
      absenceId: req.params.absenceId,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { listAbsences, createAbsence, updateAbsence, deleteAbsence };
