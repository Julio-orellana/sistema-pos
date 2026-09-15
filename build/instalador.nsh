; ===========================================================================
; Script NSIS propio del instalador de Windows. Lo incluye electron-builder
; (`nsis.include` en electron-builder.yml) al principio del script que genera.
; ===========================================================================
;
; Hace DOS cosas, y ninguna toca la identidad de la aplicación:
;
;   1. El título de la ventana del asistente dice «Instalación de Vixo POS».
;   2. Una página con una casilla para elegir si se crea el acceso directo en
;      el escritorio.
;
; ---------------------------------------------------------------------------
; LO QUE ESTE ARCHIVO NO PUEDE TOCAR, Y POR QUÉ
; ---------------------------------------------------------------------------
; La carpeta de datos (%APPDATA%\POS Jimmy Cano\) y la llave de safeStorage
; salen de `productName` dentro del package.json del asar (§4.23 y §4.37 de
; CLAUDE.md), no de este script. `Caption` es un atributo SOLO de la ventana
; del instalador: no llega al asar, ni al registro, ni a la carpeta de
; instalación, ni al nombre de los accesos directos. Por eso se cambia el
; título con `Caption` y NO con `Name`: `Name` también es solo de NSIS, pero
; está en todos los textos del asistente y electron-builder ya lo fija en
; common.nsh; declararlo dos veces es una advertencia, y el empaquetado corre
; con -WX (advertencia = error).
;
; Leído en node_modules/app-builder-lib 26.15.3 (templates/nsis):
;   - common.nsh fija `Name "${PRODUCT_NAME}"` y `BrandingText`, y no `Caption`.
;   - assistedInstaller.nsh inserta `customPageAfterChangeDir` después de la
;     página de carpeta y antes de la de instalación.
;   - installSection.nsh inserta `customInstall` DESPUÉS de `addDesktopLink`.
;
; Todo va dentro de `!ifndef BUILD_UNINSTALLER`: electron-builder compila el
; desinstalador con este mismo encabezado, y ahí las variables quedarían sin
; usar (otra advertencia, otro error con -WX).
; ===========================================================================

; ---------------------------------------------------------------------------
; EL NOMBRE QUE MUESTRAN EL INSTALADOR Y EL DESINSTALADOR
; ---------------------------------------------------------------------------
; electron-builder pasa `-DPRODUCT_NAME=POS Jimmy Cano` y este archivo se
; incluye ANTES de common.nsh, que lo usa para `Name` y `BrandingText`. Se
; redefine acá, para el instalador y el desinstalador, y así todos los textos
; del asistente dicen «Vixo POS».
;
; ES SEGURO PORQUE PRODUCT_NAME NO FORMA NINGUNA RUTA. Leído en
; templates/nsis de app-builder-lib 26.15.3: PRODUCT_NAME aparece solo en
; `BrandingText`, `Name` (common.nsh) y dos `DetailPrint`. Las rutas usan
; PRODUCT_FILENAME y APP_FILENAME: la carpeta de instalación, el `.exe`, el
; desinstalador y `$APPDATA\${APP_FILENAME}`. Esos NO se redefinen, y la
; carpeta de datos y la llave de safeStorage salen de `productName` del asar,
; que el instalador no toca. La prueba `instalador-marca-y-licencia.test.ts`
; exige que este archivo no redefina ninguno de esos identificadores.
!ifdef PRODUCT_NAME
  !undef PRODUCT_NAME
!endif
!define PRODUCT_NAME "Vixo POS"

!ifndef BUILD_UNINSTALLER

  !include nsDialogs.nsh

  ; El título de la ventana. En español, porque el instalador solo carga el
  ; español (`installerLanguages` en electron-builder.yml); es el mismo patrón
  ; que el «Instalación de $(^Name)» de SpanishInternational.nlf, con la marca.
  Caption "Instalación de Vixo POS"

  ; "1" si la persona DESMARCÓ la casilla. Vacío en cualquier otro caso.
  ;
  ; Va al revés a propósito: una instalación silenciosa (/S) o una actualización
  ; con --updated no muestran esta página, y en ese caso la variable queda
  ; vacía, así que el acceso directo se crea como lo creaba la versión anterior.
  ; Con la lógica «"1" = crear», una instalación silenciosa lo borraría sin que
  ; nadie lo haya pedido.
  Var omitirAccesoEnEscritorio
  Var casillaAccesoEnEscritorio

  !macro customPageAfterChangeDir
    Page custom PaginaDeAccesoEnEscritorio SalirDePaginaDeAccesoEnEscritorio

    Function PaginaDeAccesoEnEscritorio
      ; Igual que la licencia y la carpeta: una actualización automática no
      ; vuelve a preguntar.
      ${if} ${isUpdated}
        Abort
      ${endif}

      !insertmacro MUI_HEADER_TEXT "Acceso directo" "Elegí si querés un acceso directo en el escritorio."

      nsDialogs::Create 1018
      Pop $0
      ${if} $0 == error
        Abort
      ${endif}

      ${NSD_CreateLabel} 0 0 100% 24u "El programa se va a poder abrir siempre desde el menú Inicio. Además, puede tener un acceso directo en el escritorio."
      Pop $0

      ${NSD_CreateCheckbox} 0 32u 100% 12u "Crear un acceso directo en el escritorio"
      Pop $casillaAccesoEnEscritorio

      ; Marcada salvo que la persona ya la haya desmarcado y vuelva atrás.
      ${if} $omitirAccesoEnEscritorio != "1"
        ${NSD_Check} $casillaAccesoEnEscritorio
      ${endif}

      nsDialogs::Show
    FunctionEnd

    Function SalirDePaginaDeAccesoEnEscritorio
      ${NSD_GetState} $casillaAccesoEnEscritorio $0
      ${if} $0 == ${BST_CHECKED}
        StrCpy $omitirAccesoEnEscritorio ""
      ${else}
        StrCpy $omitirAccesoEnEscritorio "1"
      ${endif}
    FunctionEnd
  !macroend

  ; electron-builder crea el acceso directo del escritorio en `addDesktopLink`
  ; (createDesktopShortcut: true) y recién después inserta esta macro. Si la
  ; persona desmarcó la casilla, se quita con el mismo par de llamadas que usa
  ; el desinstalador de electron-builder. Se hace así, y no apagando la
  ; creación con `createDesktopShortcut: false`, porque con `false`
  ; electron-builder define DO_NOT_CREATE_DESKTOP_SHORTCUT y su desinstalador
  ; deja de borrar el acceso directo: habría que reescribir la creación Y el
  ; borrado.
  !macro customInstall
    ${if} $omitirAccesoEnEscritorio == "1"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endif}
  !macroend

!endif
