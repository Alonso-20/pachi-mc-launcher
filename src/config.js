// ============================================================
// CONFIGURACIÓN DEL LAUNCHER
//
// URL "raw" del manifest en GitHub. Es lo único que queda grabado dentro del
// .exe: si se cambia (por ejemplo de rama), hay que recompilar y repartir el
// instalador otra vez. El contenido del manifest sí se lee en vivo.
//
// Nota: esta dirección no se muestra en ninguna parte de la interfaz, pero
// sigue estando dentro del paquete. No la trates como un secreto.
// ============================================================
module.exports = {
  MANIFEST_URL: 'https://raw.githubusercontent.com/Alonso-20/pachi-mc-launcher/aero-mc/remote/manifest.json',
};
