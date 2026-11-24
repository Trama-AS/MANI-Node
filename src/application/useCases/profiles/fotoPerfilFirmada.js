const { logger } = require('../../../infrastructure/observability/logger');

/**
 * Vigencia de la URL de la foto de perfil. El bucket es privado, así que la app recibe una URL firmada que vence; la
 * pide de nuevo cada vez que abre el perfil (SCRUM-1634).
 */
const SEGUNDOS_URL_FOTO = 60 * 60;

const esUrlAbsoluta = (valor) => /^https?:\/\//i.test(valor);

/**
 * La base guarda la ruta de la foto en Storage (`kyc-documentos/<tenant>/<usuario>/avatar-….jpg`); el cliente necesita
 * una URL que pueda abrir. Devuelve una copia del perfil con `photoUrl` firmada. Si la firma falla, el perfil sale sin
 * foto en vez de fallar entero: sin foto la app muestra las iniciales (SCRUM-1634).
 */
async function conFotoFirmada(perfil, fileStorageService) {
  const ruta = perfil?.photoUrl;
  if (typeof ruta !== 'string' || !ruta.trim() || esUrlAbsoluta(ruta)) return perfil;

  const resultado = { ...perfil };
  try {
    if (!fileStorageService) throw new Error('sin servicio de Storage');
    const { signedUrl } = await fileStorageService.createSignedUrl(ruta, SEGUNDOS_URL_FOTO);
    resultado.photoUrl = signedUrl;
  } catch (err) {
    delete resultado.photoUrl;
    logger.warn({
      event: 'profile_photo_sign_failed',
      userId: perfil.userId || perfil.id,
      message: `No se pudo firmar la foto de perfil: ${err?.message || err}`,
    });
  }
  return resultado;
}

module.exports = { conFotoFirmada, SEGUNDOS_URL_FOTO };
