param(
  [Parameter(Position = 0)][string]$Cmd = 'help',
  [Parameter(Position = 1)][string]$A1,
  [Parameter(Position = 2)][string]$A2,
  [Parameter(Position = 3)][string]$A3
)
# cc.ps1 - manejar Claude Code sin GUI (headless).
#   .\cc.ps1 ask "pregunta"        respuesta sincronica (claude -p)
#   .\cc.ps1 bg "tarea"            sesion en background, devuelve el id
#   .\cc.ps1 list                  sesiones en background
#   .\cc.ps1 logs <id>             salida reciente de esa sesion
#   .\cc.ps1 stop <id>             parar (la conversacion queda)
#   .\cc.ps1 resume <id> "tarea"   continuar esa sesion
#   .\cc.ps1 attach <id>           (interactivo: mejor abrir terminal)

$ErrorActionPreference = 'Stop'
$claude = (Get-Command claude).Source

function Need($v, $name) { if (-not $v) { Write-Error "falta $name"; exit 1 } }

switch ($Cmd.ToLower()) {
  'ask' {
    Need $A1 'el prompt'
    $prompt = (@($A1, $A2, $A3) | Where-Object { $_ }) -join ' '
    & $claude -p $prompt --output-format text 2>&1
  }
  'bg' {
    Need $A1 'el prompt'
    $prompt = (@($A1, $A2, $A3) | Where-Object { $_ }) -join ' '
    & $claude --bg $prompt 2>&1
  }
  'list' { & $claude agents 2>&1 }
  'logs' { Need $A1 'el id'; & $claude logs $A1 2>&1 }
  'stop' { Need $A1 'el id'; & $claude stop $A1 2>&1 }
  'rm' { Need $A1 'el id'; & $claude rm $A1 2>&1 }
  'resume' {
    Need $A1 'el id'
    Need $A2 'el prompt'
    $prompt = (@($A2, $A3) | Where-Object { $_ }) -join ' '
    & $claude --resume $A1 -p $prompt --output-format text 2>&1
  }
  'attach' { Need $A1 'el id'; "usa una terminal persistente: claude attach $A1" }
  default {
    @'
cc.ps1 <cmd> [args]
  ask "prompt"          respuesta sincronica
  bg "tarea"            sesion en background (devuelve id)
  list                  listar sesiones
  logs <id>             salida reciente
  stop <id>             parar
  rm <id>               borrar
  resume <id> "tarea"   continuar
'@
  }
}
