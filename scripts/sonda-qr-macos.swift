// Lee un código QR de una imagen con CoreImage (CIDetector) e imprime lo que codifica.
//
// La usa `verify:pantallas:caja` para comprobar que el QR de inscripción que
// dibuja la aplicación real se puede leer y codifica exactamente la URI
// otpauth:// con el secreto que se muestra en texto. Es un lector ajeno a la
// librería que genera el QR, que es lo que le da valor a la comprobación.
//
// Solo macOS. Código 0: leyó al menos un QR; 1: ninguno legible; 2: no abrió la imagen.
import CoreImage
import Foundation

let ruta = CommandLine.arguments[1]
guard let imagen = CIImage(contentsOf: URL(fileURLWithPath: ruta)) else {
  print("NO SE PUDO ABRIR LA IMAGEN")
  exit(2)
}
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
let lecturas = detector.features(in: imagen).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
if lecturas.isEmpty {
  print("NINGÚN QR LEGIBLE")
  exit(1)
}
for lectura in lecturas {
  print(lectura)
}
