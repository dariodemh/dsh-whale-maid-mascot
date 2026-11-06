# Restaura el BOM UTF-8 de los .ps1 del plugin y comprueba que compilen.
#
# Motivo: PowerShell 5.1 lee los .ps1 sin BOM como ANSI. Un emoji o un acento en el
# archivo (p. ej. el "📎" de la etiqueta del adjunto) rompe la cadena, el script no
# compila y la ventana de Cala muere con exit 1 sin decir nada.
# Muchos editores guardan UTF-8 sin BOM: después de editar, correr esto.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\fix-ps1-bom.ps1
#
# Sale con código 1 si algún archivo sigue teniendo errores de sintaxis.

$pluginRoot = Split-Path -Parent $PSScriptRoot
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
$failed = 0

$files = Get-ChildItem -Path $pluginRoot -Recurse -Filter '*.ps1' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\.bak' -and $_.Name -ne 'fix-ps1-bom.ps1' }

foreach ($file in $files) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    if (-not $hasBom) {
      $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
      [System.IO.File]::WriteAllText($file.FullName, $text, $utf8Bom)
      Write-Output ("BOM restaurado: " + $file.Name)
    }

    $errors = $null
    $tokens = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors)
    if ($null -ne $errors -and $errors.Count -gt 0) {
      $failed++
      Write-Output ("ERRORES de sintaxis en " + $file.Name + ":")
      $errors | Select-Object -First 5 | ForEach-Object {
        Write-Output ("  línea " + $_.Extent.StartLineNumber + ": " + $_.Message)
      }
    } else {
      Write-Output ("ok: " + $file.Name)
    }
  } catch {
    $failed++
    Write-Output ("no pude procesar " + $file.FullName + ": " + $_.Exception.Message)
  }
}

if ($failed -gt 0) {
  Write-Output ""
  Write-Output "Hay $failed archivo(s) con problemas. La ventana no va a abrir hasta corregirlos."
  exit 1
}

Write-Output ""
Write-Output "Todos los .ps1 con BOM y sin errores de sintaxis."
exit 0
