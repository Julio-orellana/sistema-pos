// Sonda de diagnóstico para macOS.
//
// Lee NSApp.currentSystemPresentationOptions, que refleja las "Presentation
// Options" que la aplicación en primer plano le impuso AL SISTEMA. Dos de esas
// banderas son las que apagan mecanismos de escape del sistema operativo:
//
//   disableForceQuit        -> deshabilita Cmd+Option+Esc (Forzar Salida)
//   disableProcessSwitching -> deshabilita Cmd+Tab
//
// La regla del proyecto es que el POS NUNCA debe activarlas. Esta sonda es la
// forma de comprobarlo, en vez de afirmarlo.
//
// Compilar:  swiftc -O scripts/sonda-presentacion-macos.swift -o <salida>
// Uso:       <salida>            imprime JSON con las banderas activas

import Cocoa

let app = NSApplication.shared
let opciones = app.currentSystemPresentationOptions

let banderas: [(String, NSApplication.PresentationOptions)] = [
  ("autoHideDock", .autoHideDock),
  ("hideDock", .hideDock),
  ("autoHideMenuBar", .autoHideMenuBar),
  ("hideMenuBar", .hideMenuBar),
  ("disableAppleMenu", .disableAppleMenu),
  ("disableProcessSwitching", .disableProcessSwitching),
  ("disableForceQuit", .disableForceQuit),
  ("disableSessionTermination", .disableSessionTermination),
  ("disableHideApplication", .disableHideApplication),
  ("disableMenuBarTransparency", .disableMenuBarTransparency),
  ("fullScreen", .fullScreen),
  ("autoHideToolbar", .autoHideToolbar),
]

let activas = banderas.filter { opciones.contains($0.1) }.map { $0.0 }

// Las dos que jamás deben aparecer.
let bloqueaForceQuit = opciones.contains(.disableForceQuit)
let bloqueaCmdTab = opciones.contains(.disableProcessSwitching)

let json = """
{"valorCrudo":\(opciones.rawValue),\
"banderasActivas":[\(activas.map { "\"\($0)\"" }.joined(separator: ","))],\
"bloqueaForceQuit":\(bloqueaForceQuit),\
"bloqueaCmdTab":\(bloqueaCmdTab)}
"""
print(json)
