; HTML Lab joins the Open With list for .html, .htm, .css, .js, .json, .md and .txt.
; It never becomes the default: the usual app keeps double-click.

!macro HL_ADD_TYPE EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "HTMLLab.Document" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro HL_REMOVE_TYPE EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "HTMLLab.Document"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\HTMLLab.Document" "" "HTML Lab file"
  WriteRegStr SHCTX "Software\Classes\HTMLLab.Document\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\HTMLLab.Document\shell\open" "FriendlyAppName" "HTML Lab"
  WriteRegStr SHCTX "Software\Classes\HTMLLab.Document\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "HTML Lab"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  !insertmacro HL_ADD_TYPE "html"
  !insertmacro HL_ADD_TYPE "htm"
  !insertmacro HL_ADD_TYPE "css"
  !insertmacro HL_ADD_TYPE "js"
  !insertmacro HL_ADD_TYPE "json"
  !insertmacro HL_ADD_TYPE "md"
  !insertmacro HL_ADD_TYPE "txt"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro HL_REMOVE_TYPE "html"
  !insertmacro HL_REMOVE_TYPE "htm"
  !insertmacro HL_REMOVE_TYPE "css"
  !insertmacro HL_REMOVE_TYPE "js"
  !insertmacro HL_REMOVE_TYPE "json"
  !insertmacro HL_REMOVE_TYPE "md"
  !insertmacro HL_REMOVE_TYPE "txt"
  DeleteRegKey SHCTX "Software\Classes\HTMLLab.Document"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
