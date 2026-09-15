/**
 * La matriz de módulos del QR de inscripción remota.
 *
 * El QR se arma en el proceso principal y viaja a la ventana como una matriz de
 * booleanos, que la pantalla dibuja con rectángulos SVG. Así la ventana no
 * recibe HTML ni una URL `data:` que tuviera que inyectar, y la política de
 * seguridad de contenido no cambia.
 *
 * La librería es `qrcode-generator` (MIT): JavaScript puro, sin dependencias,
 * sin guiones de instalación y sin binarios nativos. Comprobado sobre el paquete
 * instalado: su `package.json` no declara `dependencies` ni `gypfile`, y no trae
 * ningún `.node`, `binding.gyp` ni `prebuilds/`.
 */

import qrcode from 'qrcode-generator';

/**
 * Nivel de corrección de errores M (~15 %): el que usan casi todos los QR de
 * apps de autenticación. Una URI `otpauth://` de unos 130 caracteres cabe con
 * holgura y el QR queda de un tamaño que un teléfono lee sin acercarse mucho.
 */
const NIVEL_DE_CORRECCION = 'M';

/**
 * Devuelve la matriz del QR que codifica `texto`: `true` es un módulo oscuro.
 *
 * Solo acepta ASCII imprimible. La URI ya viene codificada para URI
 * (`uriOtpauth`), así que un carácter fuera de ese rango es un error de quien
 * llama, y aceptarlo dejaría a la librería elegir una codificación que el
 * teléfono podría leer distinto.
 */
export function matrizDeQr(texto: string): boolean[][] {
  if (!/^[\x20-\x7e]+$/.test(texto)) {
    throw new Error('El QR de inscripción solo codifica texto ASCII imprimible.');
  }
  // Tipo 0: la librería elige el tamaño más chico en el que entra el texto.
  const codigo = qrcode(0, NIVEL_DE_CORRECCION);
  codigo.addData(texto, 'Byte');
  codigo.make();
  const lado = codigo.getModuleCount();
  const matriz: boolean[][] = [];
  for (let fila = 0; fila < lado; fila += 1) {
    const renglon: boolean[] = [];
    for (let columna = 0; columna < lado; columna += 1) {
      renglon.push(codigo.isDark(fila, columna));
    }
    matriz.push(renglon);
  }
  return matriz;
}
