param(
  [Parameter(Mandatory = $true)][string]$Sprite,
  [string]$ConfigPath = '',
  [int]$Width = 220,
  [int]$X = 0,
  [int]$Y = 0,
  [switch]$NoTopMost
)

# Cala de escritorio: sprite transparente flotando sobre el escritorio y una
# ventana de conversación que usa la MISMA sesión que el puente de Telegram.
#
# Reglas de oro de este archivo:
#  - PowerShell 5.1 lee los .ps1 sin BOM como ANSI: guardar SIEMPRE con BOM.
#  - Cualquier excepción fuera de un handler cierra la ventana (exit 1):
#    todo lo que corre en handlers va envuelto en try/catch.
#  - El chat habla con la API del plugin (/chat), no con el modelo directo.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$script:configPath = $ConfigPath
$script:spritePath = $Sprite
$script:width = $Width
$script:ratio = 1.0
# El host no siempre exporta DSH_WEB_URL al proceso hijo: se descubre el puerto
# local que realmente sirve las rutas del plugin.
function Find-BaseUrl {
  # netstat es rápido (~90 ms); los puertos se prueban en paralelo con un
  # cliente HTTP corto, así el arranque no se queda esperando puertos ajenos.
  if ($env:DSH_WEB_URL) {
    $base = $env:DSH_WEB_URL.TrimEnd('/')
    try {
      $res = Invoke-WebRequest -Uri ($base + '/whale-maid-mascot/desktop?action=status') -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -eq 200) { return $base }
    } catch { }
  }
  $ports = @()
  try {
    $lines = netstat -ano -p tcp | Select-String 'LISTENING' | Select-String '127\.0\.0\.1:'
    foreach ($line in $lines) {
      if ($line.Line -match '127\.0\.0\.1:(\d+)') { $ports += [string]$matches[1] }
    }
    $ports = $ports | Sort-Object -Unique
  } catch { }
  $client = New-Object System.Net.Http.HttpClient
  $client.Timeout = [TimeSpan]::FromMilliseconds(900)
  $tasks = @()
  foreach ($p in $ports) {
    try {
      $tasks += [PSCustomObject]@{
        Port = $p
        Task = $client.GetAsync(('http://127.0.0.1:' + $p + '/whale-maid-mascot/desktop?action=status'))
        Done = $false
      }
    } catch { }
  }
  $found = ''
  $deadline = [DateTime]::Now.AddSeconds(2.5)
  while ($found -eq '' -and [DateTime]::Now -lt $deadline) {
    $pending = $false
    foreach ($t in $tasks) {
      if ($t.Done) { continue }
      if (-not $t.Task.IsCompleted) { $pending = $true; continue }
      $t.Done = $true
      try {
        if ([int]$t.Task.Result.StatusCode -eq 200) { $found = 'http://127.0.0.1:' + $t.Port }
      } catch { }
    }
    if ($found -eq '' -and $pending) { Start-Sleep -Milliseconds 40 }
    if (-not $pending) { break }
  }
  $client.Dispose()
  if ($found -ne '') { return $found }
  return 'http://127.0.0.1:49477'
}
$script:baseUrl = Find-BaseUrl


$script:logPath = Join-Path $env:TEMP 'cala-window.log'
function Log-Note([string]$m) {
  try { [System.IO.File]::AppendAllText($script:logPath, ((Get-Date).ToString('HH:mm:ss.fff') + ' ' + $m + "`r`n")) } catch { }
}

$script:http = New-Object System.Net.Http.HttpClient
$script:http.Timeout = [TimeSpan]::FromSeconds(180)

# --- Telegram: el hilo de la ventana y el del bot son el mismo --------------
try {
  $tokenFile = Join-Path $env:USERPROFILE '.dsh\whale-maid.token'
  if (Test-Path -LiteralPath $tokenFile) { $script:tgToken = ([System.IO.File]::ReadAllText($tokenFile)).Trim() }
  $stateFile = Join-Path $env:USERPROFILE '.dsh\whale-maid.state.json'
  if (Test-Path -LiteralPath $stateFile) {
    $state = [System.IO.File]::ReadAllText($stateFile) | ConvertFrom-Json
    $allowed = @($state.allowed)
    if ($allowed.Count -gt 0) { $script:tgChat = [string]$allowed[0] }
  }
} catch { }

# Espeja un mensaje al chat de Telegram del dueño, para que los dos lados
# muestren la misma conversación.
function Send-Telegram([string]$text, [long]$replyTo = 0) {
  try {
    if ([string]::IsNullOrEmpty($script:tgToken) -or [string]::IsNullOrEmpty($script:tgChat)) { return $null }
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $payload = @{ chat_id = $script:tgChat; text = $text }
    if ($replyTo -gt 0) { $payload.reply_to_message_id = $replyTo }
    $json = ($payload | ConvertTo-Json -Compress)
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    $task = $script:http.PostAsync(('https://api.telegram.org/bot' + $script:tgToken + '/sendMessage'), $content)
    $script:tgTasks += $task
    Log-Note ("telegram send queued: len=" + $text.Length + " reply=" + $replyTo)
    return $task
  } catch { return $null }
}

function Test-HistoryNoise([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $true }
  if ($text.Length -gt 700) { return $true }
  if ($text -match 'Current runtime context|Time sampled|approval policy|<system-reminder>|<available_skills>|</available-skills>|\[model changed|Usage \d|Haz esto:') { return $true }
  return $false
}

# Agrega al panel solo los mensajes que todavía no se mostraron (sin duplicar
# los que ya agregó esta ventana al enviar/recibir).
function Add-HistoryItems($items) {
  try {
    foreach ($item in @($items)) {
      $txt = [string]$item.text
      $imageUrl = ''
      $imageId = ''
      if ($null -ne $item.image -and -not [string]::IsNullOrWhiteSpace([string]$item.image.url)) {
        $imageUrl = [string]$item.image.url
        $imageId = [string]$item.image.id
      }
      if ($imageUrl -ne '') {
        $imgKey = 'img|' + $(if ($imageId -ne '') { $imageId } else { $imageUrl })
        $imgWho = if ([string]$item.role -eq 'user') { 'user' } else { 'cala' }
        if ($script:rendered.ContainsKey($imgKey)) { continue }
        Add-HistoryImage $imageUrl $txt $imgWho
        $script:rendered[$imgKey] = $true
        continue
      }
      if (Test-HistoryNoise $txt) { continue }
      $who = if ([string]$item.role -eq 'user') { 'user' } else { 'cala' }
      $norm = ($txt -replace '\s+', ' ').Trim()
      if ($script:recentTexts -contains $norm) { continue }
      $key = $who + '|' + $txt
      if ($script:rendered.ContainsKey($key)) { continue }
      Add-ChatLine $txt $who
    }
  } catch { }
}
$script:pending = $null
$script:historyTask = $null
$script:chatLoaded = $false
$script:typing = $null
$script:chatWin = $null
$script:chatBox = $null
$script:chatHint = $null
$script:chatThumbs = $null
$script:chatThumbsHost = $null
$script:chatImages = @()
$script:menuPopup = $null
$script:menuPanel = $null
$script:rendered = @{}
$script:recentTexts = @()
$script:windowTurn = $false
$script:syncTask = $null
$script:tgTasks = @()
$script:tgUserTask = $null
$script:tgReplyTo = [long]0

function Read-Config {
  if (-not $script:configPath -or -not (Test-Path -LiteralPath $script:configPath)) { return $null }
  try { return ([System.IO.File]::ReadAllText($script:configPath) | ConvertFrom-Json) } catch { return $null }
}

function Save-Config([hashtable]$patch) {
  if (-not $script:configPath -or -not (Test-Path -LiteralPath $script:configPath)) { return }
  try {
    $cfg = Read-Config
    if ($null -eq $cfg) { return }
    foreach ($key in $patch.Keys) {
      $cfg | Add-Member -NotePropertyName $key -NotePropertyValue $patch[$key] -Force
    }
    $json = $cfg | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($script:configPath, $json, (New-Object System.Text.UTF8Encoding($false)))
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Load-Sprite([string]$path) {
  $image = New-Object System.Windows.Media.Imaging.BitmapImage
  $image.BeginInit()
  $image.UriSource = New-Object System.Uri($path)
  $image.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $image.EndInit()
  return $image
}

# --- sprite selection: prefer the high-resolution set next to the sprite ------
$config = Read-Config
$spriteDir = Split-Path -Parent $Sprite
$hiresDir = Join-Path $spriteDir 'hires'
$baseKey = if ($config -and $config.desktopSprite) { [string]$config.desktopSprite } else { 'a' }
$chosenKey = $baseKey
if ($config -and $config.desktopHiresSprite) {
  $candidate = Join-Path $hiresDir ([string]$config.desktopHiresSprite + '.png')
  if (Test-Path -LiteralPath $candidate) { $chosenKey = [string]$config.desktopHiresSprite; $script:spritePath = $candidate }
}
$spriteChoice = Join-Path $hiresDir ($chosenKey + '.png')
if (Test-Path -LiteralPath $spriteChoice) { $script:spritePath = $spriteChoice }

# --- Chan: un sprite por estado de ánimo ------------------------------------
$script:chanDir = Join-Path $spriteDir 'chan'
$script:chanStates = [ordered]@{
  base = 'base-saludando.png'
  notas = 'tomando-notas.png'
  lentes = 'analizando-con-lentes.png'
  seria = 'seria-formal.png'
  cafe = 'explicando-con-cafe.png'
  cocina = 'cocinando.png'
  pensando = 'comiendo-tokens.png'
  dudas = 'dudando-pensativa.png'
  espera = 'esperando-aburrida.png'
  flotando = 'flotando-sonando.png'
  playa = 'descansando-en-la-playa.png'
  novia = 'celebrando-de-novia.png'
}
$script:chanViews = [ordered]@{
  atender = 'atendiendo-maid-alegre.png'
  paso = 'de-paso-maid-alegre.png'
  espaldas = 'de-espaldas-maid-alegre.png'
}
$script:chanLabels = @{
  base = 'Base'; notas = 'Notas'; lentes = 'Lentes'; seria = 'Seria'; cafe = 'Café'; cocina = 'Cocina'
  pensando = 'Pensando'; dudas = 'Dudas'; espera = 'Espera'; flotando = 'Flotando'; playa = 'Playa'; novia = 'Novia'
  atender = 'Atender'; paso = 'Paso'; espaldas = 'Espaldas'
}
$script:chanMoodMap = @{
  'base' = 'base'
  'tomando-notas' = 'notas'
  'analizando-con-lentes' = 'lentes'
  'seria-formal' = 'seria'
  'cocinando' = 'cocina'
  'comiendo-tokens' = 'pensando'
  'dudando-pensativa' = 'dudas'
  'esperando-aburrida' = 'espera'
  'flotando-sonando' = 'flotando'
  'descansando-en-la-playa' = 'playa'
  'celebrando-de-novia' = 'novia'
}
# Estado automático venido del host (/mood): no pisa una elección manual reciente.
$script:autoMoodState = ''
$script:autoMoodMood = ''
$script:moodManualUntil = [datetime]::MinValue
$script:moodTask = $null
$script:defaultState = 'base'
if ($config -and $config.desktopChanState) {
  $wanted = [string]$config.desktopChanState
  if ($script:chanStates.Contains($wanted) -or $script:chanViews.Contains($wanted)) { $script:defaultState = $wanted }
}
$script:currentState = $script:defaultState
if (Test-Path -LiteralPath $script:chanDir) {
  $chanFile = ''
  if ($script:chanStates.Contains($script:defaultState)) { $chanFile = Join-Path $script:chanDir $script:chanStates[$script:defaultState] }
  elseif ($script:chanViews.Contains($script:defaultState)) { $chanFile = Join-Path $script:chanDir $script:chanViews[$script:defaultState] }
  if ($chanFile -ne '' -and (Test-Path -LiteralPath $chanFile)) { $script:spritePath = $chanFile }
}

$script:img = Load-Sprite $script:spritePath
if ($script:img.PixelWidth -le 0) { throw 'sprite sin pixeles' }
$script:ratio = $script:img.PixelHeight / $script:img.PixelWidth
$script:chosenKey = $chosenKey

# --- window -----------------------------------------------------------------
$script:win = New-Object System.Windows.Window
$script:win.WindowStyle = [System.Windows.WindowStyle]::None
$script:win.AllowsTransparency = $true
$script:win.Background = [System.Windows.Media.Brushes]::Transparent
$script:win.ShowInTaskbar = $false
$script:win.Topmost = (-not $NoTopMost)
$script:win.ResizeMode = [System.Windows.ResizeMode]::NoResize
$script:win.Cursor = [System.Windows.Input.Cursors]::Hand
$script:win.Width = $Width
$script:win.Height = [math]::Round($Width * $script:ratio)

$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
if ($X -le 0) { $X = $area.Right - $script:win.Width - 24 }
if ($Y -le 0) { $Y = $area.Bottom - $script:win.Height - 8 }
$script:win.Left = $X
$script:win.Top = $Y

# --- layout: corte transparente, sprite, burbuja, entrada de chat -----------
$grid = New-Object System.Windows.Controls.Grid

$script:image = New-Object System.Windows.Controls.Image
$script:image.Source = $script:img
$script:image.Stretch = [System.Windows.Media.Stretch]::Uniform
$script:image.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 0.88)

# Flotación del plugin original: un vaivén vertical (3.4 s) y una cadencia
# izquierda-derecha con leve rotación (4.4 s), girando desde la base.
$script:bob = New-Object System.Windows.Media.TranslateTransform
$script:sway = New-Object System.Windows.Media.RotateTransform
$script:hop = New-Object System.Windows.Media.TranslateTransform
$transformGroup = New-Object System.Windows.Media.TransformGroup
[void]$transformGroup.Children.Add($script:bob)
[void]$transformGroup.Children.Add($script:sway)
[void]$transformGroup.Children.Add($script:hop)
$script:image.RenderTransform = $transformGroup

$bobAnim = New-Object System.Windows.Media.Animation.DoubleAnimation
$bobAnim.From = 0.0
$bobAnim.To = -7.0
$bobAnim.Duration = New-Object System.Windows.Duration([TimeSpan]::FromSeconds(3.4))
$bobAnim.AutoReverse = $true
$bobAnim.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$bobAnim.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
$bobAnim.EasingFunction.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseInOut
$script:bob.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $bobAnim)

$swayAnim = New-Object System.Windows.Media.Animation.DoubleAnimation
$swayAnim.From = -1.8
$swayAnim.To = 1.8
$swayAnim.Duration = New-Object System.Windows.Duration([TimeSpan]::FromSeconds(4.4))
$swayAnim.AutoReverse = $true
$swayAnim.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
$swayAnim.EasingFunction = New-Object System.Windows.Media.Animation.SineEase
$swayAnim.EasingFunction.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseInOut
$script:sway.BeginAnimation([System.Windows.Media.RotateTransform]::AngleProperty, $swayAnim)

$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.BlurRadius = 18
$shadow.ShadowDepth = 10
$shadow.Direction = 270
$shadow.Opacity = 0.30
$shadow.Color = [System.Windows.Media.Color]::FromRgb(15, 23, 42)
$script:image.Effect = $shadow

$script:bubble = New-Object System.Windows.Controls.Border
$script:bubble.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(240, 30, 41, 59))
$script:bubble.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(45, 255, 255, 255))
$script:bubble.BorderThickness = New-Object System.Windows.Thickness(1)
$script:bubble.CornerRadius = New-Object System.Windows.CornerRadius(12)
$script:bubble.Padding = New-Object System.Windows.Thickness(10, 7, 10, 7)
$script:bubble.Margin = New-Object System.Windows.Thickness(6, 6, 6, 0)
$script:bubble.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
$script:bubble.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Stretch
$script:bubble.Opacity = 0
$script:bubble.IsHitTestVisible = $false

$bubbleText = New-Object System.Windows.Controls.TextBlock
$bubbleText.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
$bubbleText.FontSize = 12
$bubbleText.LineHeight = 16
$bubbleText.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(241, 245, 249))
$bubbleText.TextWrapping = [System.Windows.TextWrapping]::Wrap
$script:bubble.Child = $bubbleText

[void]$grid.Children.Add($script:image)
[void]$grid.Children.Add($script:bubble)
$script:win.Content = $grid

# --- behaviour --------------------------------------------------------------
$script:lines = @(
  '¿Otra vez trabajando? Yo te acompaño uwu',
  'Toma agüita.',
  'Ese commit no se va a hacer solo.',
  'Descansa cinco minutos, ¿sí?',
  'Te vi concentrado, no te interrumpo.',
  '¿Ya comiste?',
  'Yo vigilo, tú escribes.',
  'Qué buen avance hoy.',
  'No olvides guardar.',
  'Aquí sigo, por si me necesitas.'
)

function Show-Bubble([string]$text) {
  try {
    $bubbleText.Text = $text
    $fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, (New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(140))))
    $script:bubble.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fadeIn)
    $script:bubbleTimer.Stop()
    $script:bubbleTimer.Start()
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Hide-Bubble {
  try {
    $fadeOut = New-Object System.Windows.Media.Animation.DoubleAnimation(1, 0, (New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(220))))
    $script:bubble.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fadeOut)
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Hop {
  try {
    $anim = New-Object System.Windows.Media.Animation.DoubleAnimation
    $anim.From = 0.0
    $anim.To = -16.0
    $anim.Duration = New-Object System.Windows.Duration([TimeSpan]::FromMilliseconds(170))
    $anim.AutoReverse = $true
    $anim.FillBehavior = [System.Windows.Media.Animation.FillBehavior]::Stop
    $script:hop.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $anim)
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

$script:bubbleTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:bubbleTimer.Interval = [TimeSpan]::FromSeconds(7)
$script:bubbleTimer.Add_Tick({ try { Hide-Bubble; $script:bubbleTimer.Stop() } catch { } })

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WmWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

function Focus-Harness {
  try {
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match 'DeepSeek' } | Select-Object -First 1
    if ($proc) {
      [void][WmWin32]::ShowWindow($proc.MainWindowHandle, 9)
      [void][WmWin32]::SetForegroundWindow($proc.MainWindowHandle)
    }
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Save-Position {
  Save-Config @{
    desktopX = [int][math]::Round($script:win.Left)
    desktopY = [int][math]::Round($script:win.Top)
    desktopWidth = [int][math]::Round($script:win.Width)
  }
}

function Resize-Sprite([int]$w) {
  try {
    $script:win.Width = $w
    $script:win.Height = [math]::Round($w * $script:ratio)
    $script:width = $w
    Save-Position
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Set-ChanState([string]$key, [bool]$remember) {
  try {
    $file = ''
    if ($script:chanStates.Contains($key)) { $file = Join-Path $script:chanDir $script:chanStates[$key] }
    elseif ($script:chanViews.Contains($key)) { $file = Join-Path $script:chanDir $script:chanViews[$key] }
    if ($file -eq '' -or -not (Test-Path -LiteralPath $file)) { return }
    $img = Load-Sprite $file
    $script:img = $img
    $script:image.Source = $img
    $script:ratio = $img.PixelHeight / $img.PixelWidth
    $script:currentState = $key
    $script:win.Height = [math]::Round($script:win.Width * $script:ratio)
    if ($remember) {
      $script:defaultState = $key
      Save-Config @{ desktopChanState = $key }
      $script:moodManualUntil = (Get-Date).AddSeconds(90)
    }
  } catch { }
}

# El ánimo que devuelve /chat elige el sprite, como pide personalidades.txt.
function State-FromMood([string]$mood) {
  switch ([string]$mood) {
    'angry' { return 'seria' }
    'sad' { return 'flotando' }
    'sleepy' { return 'playa' }
    'surprised' { return 'dudas' }
    'thinking' { return 'dudas' }
    default { return $script:defaultState }
  }
}

# El host deriva el ánimo de la actividad real de la sesión compartida; acá solo
# se pinta la imagen. Histéresis y prioridad viven en el host (dsh/mood.js).
function Apply-AutoMood([string]$mood) {
  try {
    if ([string]::IsNullOrWhiteSpace($mood)) { return }
    if (-not $script:chanMoodMap.ContainsKey($mood)) { return }
    $state = [string]$script:chanMoodMap[$mood]
    if ($state -eq '' -or -not $script:chanStates.Contains($state)) { return }
    $script:autoMoodMood = $mood
    if ($script:autoMoodState -eq $state) { return }
    $script:autoMoodState = $state
    Set-ChanState $state $false
    Log-Note ("mood: " + $mood + " -> " + $state)
  } catch { Log-Note ("mood apply: " + $_.Exception.Message) }
}

$script:revert = New-Object System.Windows.Threading.DispatcherTimer
$script:revert.Interval = [TimeSpan]::FromSeconds(14)
$script:revert.Add_Tick({
  try {
    $script:revert.Stop()
    $restoreState = $script:defaultState
    if ($script:autoMoodState -ne '' -and $script:chanStates.Contains($script:autoMoodState)) { $restoreState = $script:autoMoodState }
    Set-ChanState $restoreState $false
  } catch { }
})

function Revert-Later {
  try { $script:revert.Stop(); $script:revert.Start() } catch { }
}

# --- estilos compartidos -----------------------------------------------------
$script:buttonStyle = [System.Windows.Markup.XamlReader]::Parse(@"
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
  <Setter Property="Foreground" Value="#F1F5F9"/>
  <Setter Property="Background" Value="Transparent"/>
  <Setter Property="HorizontalContentAlignment" Value="Left"/>
  <Setter Property="Padding" Value="11,7"/>
  <Setter Property="FontSize" Value="12"/>
  <Setter Property="FontFamily" Value="Segoe UI"/>
  <Setter Property="Template">
    <Setter.Value>
      <ControlTemplate TargetType="Button">
        <Border x:Name="bg" CornerRadius="8" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
          <ContentPresenter VerticalAlignment="Center"/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property="IsMouseOver" Value="True">
            <Setter TargetName="bg" Property="Background" Value="#26FFFFFF"/>
          </Trigger>
          <Trigger Property="IsPressed" Value="True">
            <Setter TargetName="bg" Property="Background" Value="#3DFFFFFF"/>
          </Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>
    </Setter.Value>
  </Setter>
</Style>
"@)

$script:chipStyle = [System.Windows.Markup.XamlReader]::Parse(@"
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
  <Setter Property="Foreground" Value="#CBD5E1"/>
  <Setter Property="Background" Value="#14FFFFFF"/>
  <Setter Property="Padding" Value="9,4"/>
  <Setter Property="Margin" Value="0,0,6,6"/>
  <Setter Property="FontSize" Value="11"/>
  <Setter Property="FontFamily" Value="Segoe UI"/>
  <Setter Property="Template">
    <Setter.Value>
      <ControlTemplate TargetType="Button">
        <Border x:Name="bg" CornerRadius="9" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
          <ContentPresenter VerticalAlignment="Center"/>
        </Border>
        <ControlTemplate.Triggers>
          <Trigger Property="IsMouseOver" Value="True">
            <Setter TargetName="bg" Property="Background" Value="#2EFFFFFF"/>
            <Setter Property="Foreground" Value="#FFFFFF"/>
          </Trigger>
        </ControlTemplate.Triggers>
      </ControlTemplate>
    </Setter.Value>
  </Setter>
</Style>
"@)

function New-MenuButton([string]$label, $action) {
  $button = New-Object System.Windows.Controls.Button
  $button.Style = $script:buttonStyle
  $button.Content = $label
  $button.FontSize = 11
  $button.Padding = New-Object System.Windows.Thickness(8, 4, 8, 4)
  $button.Margin = New-Object System.Windows.Thickness(1, 1, 1, 1)
  $button.MinHeight = 24
  $button.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Stretch
  $button.HorizontalContentAlignment = [System.Windows.HorizontalAlignment]::Left
  $button.ToolTip = $label
  $button.Add_Click($action)
  return $button
}

function New-Chip([string]$label, [string]$key, [bool]$selected, $action) {
  $chip = New-Object System.Windows.Controls.Button
  $chip.Style = $script:chipStyle
  $chip.Content = $label
  $chip.Tag = $key
  $chip.FontSize = 10
  $chip.Padding = New-Object System.Windows.Thickness(7, 2, 7, 2)
  $chip.Margin = New-Object System.Windows.Thickness(2, 2, 2, 2)
  $chip.MinHeight = 22
  if ($selected) {
    $chip.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(77, 125, 211, 252))
    $chip.Foreground = [System.Windows.Media.Brushes]::White
  }
  $chip.Add_Click($action)
  return $chip
}

function New-Label([string]$text) {
  $label = New-Object System.Windows.Controls.TextBlock
  $label.Text = $text
  $label.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI Semibold")
  $label.FontSize = 8
  $label.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(125, 211, 252))
  $label.Margin = New-Object System.Windows.Thickness(9, 1, 0, 3)
  return $label
}

function New-Separator {
  $line = New-Object System.Windows.Controls.Border
  $line.Height = 1
  $line.Margin = New-Object System.Windows.Thickness(8, 3, 8, 3)
  $line.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(34, 255, 255, 255))
  return $line
}

# --- chat con memoria y sesión compartida con Telegram ----------------------
function Add-ChatLine([string]$text, [string]$who) {
  try {
    if ($null -eq $script:chatStack) { return }
    if ([string]::IsNullOrWhiteSpace($text)) { return }
    $border = New-Object System.Windows.Controls.Border
    $border.CornerRadius = New-Object System.Windows.CornerRadius(12)
    $border.Padding = New-Object System.Windows.Thickness(9, 6, 9, 6)
    $border.Margin = New-Object System.Windows.Thickness(0, 3, 0, 3)
    $border.MaxWidth = 262
    $border.HorizontalAlignment = if ($who -eq 'user') { [System.Windows.HorizontalAlignment]::Right } else { [System.Windows.HorizontalAlignment]::Left }
    if ($who -eq 'user') {
      $border.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 56, 89, 140))
    } else {
      $border.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 42, 54, 71))
    }
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = $text
    $tb.TextWrapping = [System.Windows.TextWrapping]::Wrap
    $tb.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
    $tb.FontSize = 12
    $tb.LineHeight = 17
    $tb.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(241, 245, 249))
    $border.Child = $tb
    [void]$script:chatStack.Children.Add($border)
    $script:rendered[([string]$who + '|' + $text)] = $true
    $norm = ($text -replace '\s+', ' ').Trim()
    $script:recentTexts += $norm
    if ($script:recentTexts.Count -gt 12) { $script:recentTexts = @($script:recentTexts[($script:recentTexts.Count - 12)..($script:recentTexts.Count - 1)]) }
    $script:chatScroll.ScrollToEnd()
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

# Burbuja con una imagen del hilo compartido (p. ej. una foto espejada de
# Telegram). Descarga los bytes por HTTP local para no depender de la cache de
# BitmapImage con URLs.
# Visor modal de imágenes: fondo oscuro semitransparente, imagen escalada para
# caber en pantalla sin deformarse (Uniform), X / Esc / clic fuera para cerrar y
# rueda del mouse para zoom simple. Reutiliza la misma ImageSource de la burbuja:
# no descarga nada de la red.
function Show-ImageLightbox([System.Windows.Media.ImageSource]$source) {
  try {
    if ($null -eq $source) { return }
    $viewer = New-Object System.Windows.Window
    $viewer.WindowStyle = [System.Windows.WindowStyle]::None
    $viewer.AllowsTransparency = $true
    $viewer.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(216, 8, 12, 20))
    $viewer.WindowState = [System.Windows.WindowState]::Maximized
    $viewer.ResizeMode = [System.Windows.ResizeMode]::NoResize
    $viewer.ShowInTaskbar = $false
    $viewer.Topmost = $true
    try { if ($null -ne $script:chatWin) { $viewer.Owner = $script:chatWin } } catch { }
    $root = New-Object System.Windows.Controls.Grid
    $root.Background = [System.Windows.Media.Brushes]::Transparent
    $root.Focusable = $true
    $picture = New-Object System.Windows.Controls.Image
    $picture.Source = $source
    $picture.Stretch = [System.Windows.Media.Stretch]::Uniform
    [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($picture, [System.Windows.Media.BitmapScalingMode]::HighQuality)
    $picture.Margin = New-Object System.Windows.Thickness(48)
    $scale = New-Object System.Windows.Media.ScaleTransform(1.0, 1.0)
    $picture.RenderTransform = $scale
    $picture.RenderTransformOrigin = New-Object System.Windows.Point(0.5, 0.5)
    [void]$root.Children.Add($picture)
    $closeBtn = New-Object System.Windows.Controls.Button
    $closeBtn.Content = '×'
    $closeBtn.FontSize = 26
    $closeBtn.Width = 40
    $closeBtn.Height = 40
    $closeBtn.Padding = New-Object System.Windows.Thickness(0)
    $closeBtn.BorderThickness = New-Object System.Windows.Thickness(0)
    $closeBtn.Background = [System.Windows.Media.Brushes]::Transparent
    $closeBtn.Foreground = [System.Windows.Media.Brushes]::White
    $closeBtn.Cursor = [System.Windows.Input.Cursors]::Hand
    $closeBtn.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
    $closeBtn.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
    $closeBtn.Margin = New-Object System.Windows.Thickness(0, 14, 18, 0)
    $closeBtn.ToolTip = 'Cerrar (Esc)'
    $closeBtn.Add_Click({ param($cs, $ce) try { $viewer.Close() } catch { } })
    [void]$root.Children.Add($closeBtn)
    $hint = New-Object System.Windows.Controls.TextBlock
    $hint.Text = 'Esc o clic fuera para cerrar · rueda para zoom'
    $hint.FontSize = 11
    $hint.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(180, 226, 232, 240))
    $hint.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
    $hint.VerticalAlignment = [System.Windows.VerticalAlignment]::Bottom
    $hint.Margin = New-Object System.Windows.Thickness(0, 0, 0, 18)
    $hint.IsHitTestVisible = $false
    [void]$root.Children.Add($hint)
    $root.Add_MouseLeftButtonDown({ param($gs, $ge) try { if ($ge.OriginalSource -eq $root) { $viewer.Close() } } catch { } })
    $zoom = {
      param($zs, $ze)
      try {
        $factor = if ($ze.Delta -gt 0) { 1.12 } else { 0.89 }
        $next = [Math]::Min(4.0, [Math]::Max(0.4, [double]$scale.ScaleX * $factor))
        $scale.ScaleX = $next
        $scale.ScaleY = $next
        $ze.Handled = $true
      } catch { Log-Note ("lightbox zoom: " + $_.Exception.Message) }
    }
    $viewer.Add_MouseWheel($zoom)
    $root.Add_MouseWheel($zoom)
    $viewer.Add_KeyDown({
      param($ks, $ke)
      try {
        if ($ke.Key -eq [System.Windows.Input.Key]::Escape) { $viewer.Close(); $ke.Handled = $true }
      } catch { }
    })
    $viewer.Content = $root
    [void]$viewer.ShowDialog()
  } catch { Log-Note ("lightbox error: " + $_.Exception.Message) }
}

# Burbuja de imagen clickeable (espejo/outbox y fotos que manda el usuario).
# Carga la imagen a resolución COMPLETA para el visor: la miniatura del burbuja
# se decodifica chica a propósito (DecodePixelWidth), y reutilizarla era lo que
# se veía pixelado al ampliar. Sin red: outbox por la ruta local o base64 que ya
# está en memoria.
function Load-FullImage($descriptor) {
  try {
    if ($null -eq $descriptor) { return $null }
    $kind = [string]$descriptor.kind
    $value = [string]$descriptor.value
    if ([string]::IsNullOrWhiteSpace($kind) -or [string]::IsNullOrWhiteSpace($value)) { return $null }
    $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
    if ($kind -eq 'url') {
      $bytes = $script:http.GetByteArrayAsync($value).Result
      if ($null -eq $bytes -or $bytes.Length -eq 0) { return $null }
      $stream = New-Object System.IO.MemoryStream(, $bytes)
      $bitmap.BeginInit()
      $bitmap.StreamSource = $stream
      $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bitmap.EndInit()
    } elseif ($kind -eq 'base64') {
      $bytes = [Convert]::FromBase64String($value)
      $stream = New-Object System.IO.MemoryStream(, $bytes)
      $bitmap.BeginInit()
      $bitmap.StreamSource = $stream
      $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bitmap.EndInit()
    } elseif ($kind -eq 'file') {
      $bitmap.BeginInit()
      $bitmap.UriSource = New-Object System.Uri($value)
      $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
      $bitmap.EndInit()
    } else {
      return $null
    }
    $bitmap.Freeze()
    return $bitmap
  } catch {
    Log-Note ("lightbox full image: " + $_.Exception.Message)
    return $null
  }
}

function Add-ChatImageBubble([System.Windows.Media.ImageSource]$source, [string]$caption, [string]$who, $descriptor = $null) {
  try {
    if ($null -eq $source -or $null -eq $script:chatStack) { return }
    $img = New-Object System.Windows.Controls.Image
    $img.Source = $source
    $img.Stretch = [System.Windows.Media.Stretch]::Uniform
    $img.MaxWidth = 220
    $img.MaxHeight = 220
    $img.Cursor = [System.Windows.Input.Cursors]::Hand
    $img.ToolTip = 'Clic para ver en grande'
    $img.Tag = $descriptor
    $img.Add_MouseLeftButtonUp({
      param($is, $ie)
      try {
        $ie.Handled = $true
        $fullImage = $null
        if ($null -ne $is.Tag) { $fullImage = Load-FullImage $is.Tag }
        if ($null -eq $fullImage) { $fullImage = $is.Source }
        Show-ImageLightbox $fullImage
      } catch { Log-Note ("lightbox open: " + $_.Exception.Message) }
    })
    $panel = New-Object System.Windows.Controls.StackPanel
    [void]$panel.Children.Add($img)
    if (-not [string]::IsNullOrWhiteSpace($caption) -and $caption -notmatch 'Foto enviada por Telegram') {
      $captionText = New-Object System.Windows.Controls.TextBlock
      $captionText.Text = $caption
      $captionText.TextWrapping = [System.Windows.TextWrapping]::Wrap
      $captionText.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
      $captionText.FontSize = 11
      $captionText.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
      $captionText.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(226, 232, 240))
      [void]$panel.Children.Add($captionText)
    }
    $border = New-Object System.Windows.Controls.Border
    $border.CornerRadius = New-Object System.Windows.CornerRadius(12)
    $border.Padding = New-Object System.Windows.Thickness(5)
    $border.Margin = New-Object System.Windows.Thickness(0, 3, 0, 3)
    $border.MaxWidth = 262
    $border.HorizontalAlignment = if ($who -eq 'user') { [System.Windows.HorizontalAlignment]::Right } else { [System.Windows.HorizontalAlignment]::Left }
    $border.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 56, 89, 140))
    $border.Child = $panel
    [void]$script:chatStack.Children.Add($border)
    $script:chatScroll.ScrollToEnd()
  } catch { Log-Note ("chat image bubble: " + $_.Exception.Message) }
}

function Add-HistoryImage([string]$url, [string]$caption, [string]$who) {
  try {
    if ($null -eq $script:chatStack -or [string]::IsNullOrWhiteSpace($url)) { return }
    $fullUrl = if ($url.StartsWith('http')) { $url } else { $script:baseUrl + $url }
    $bytes = $script:http.GetByteArrayAsync($fullUrl).Result
    if ($null -eq $bytes -or $bytes.Length -eq 0) { return }
    $stream = New-Object System.IO.MemoryStream(, $bytes)
    $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
    $bitmap.BeginInit()
    $bitmap.StreamSource = $stream
    $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
    $bitmap.DecodePixelWidth = 260
    $bitmap.EndInit()
    $bitmap.Freeze()
    Add-ChatImageBubble $bitmap $caption $who @{ kind = 'url'; value = $fullUrl }
  } catch { Log-Note ("history image error: " + $_.Exception.Message) }
}

function Add-Typing {
  try {
    Remove-Typing
    $border = New-Object System.Windows.Controls.Border
    $border.CornerRadius = New-Object System.Windows.CornerRadius(12)
    $border.Padding = New-Object System.Windows.Thickness(10, 6, 10, 6)
    $border.Margin = New-Object System.Windows.Thickness(0, 3, 0, 3)
    $border.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
    $border.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 42, 54, 71))
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = 'Cala está escribiendo…'
    $tb.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
    $tb.FontSize = 11
    $tb.FontStyle = [System.Windows.FontStyles]::Italic
    $tb.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(148, 163, 184))
    $border.Child = $tb
    [void]$script:chatStack.Children.Add($border)
    $script:typing = $border
    $script:chatScroll.ScrollToEnd()
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Remove-Typing {
  try {
    if ($null -ne $script:typing -and $null -ne $script:chatStack) {
      [void]$script:chatStack.Children.Remove($script:typing)
    }
  } catch { }
  $script:typing = $null
}

function Send-Chat([string]$text) {
  try {
    $images = @($script:chatImages)
    if ([string]::IsNullOrWhiteSpace($text) -and $images.Count -eq 0) { return }
    $label = if ([string]::IsNullOrWhiteSpace($text)) { '📎 Imagen' } else { $text }
    if ($images.Count -gt 0) { $label = $label + "`n📎 " + $images.Count + " imagen(es)" }
    Show-ChatWindow
    Add-ChatLine $label 'user'
    foreach ($imageEntry in $images) {
      try {
        $imageBytes = [Convert]::FromBase64String([string]$imageEntry.dataBase64)
        $imageStream = New-Object System.IO.MemoryStream(, $imageBytes)
        $imageSource = New-Object System.Windows.Media.Imaging.BitmapImage
        $imageSource.BeginInit()
        $imageSource.StreamSource = $imageStream
        $imageSource.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $imageSource.DecodePixelWidth = 260
        $imageSource.EndInit()
        $imageSource.Freeze()
        Add-ChatImageBubble $imageSource ([string]$imageEntry.name) 'user' @{ kind = 'base64'; value = [string]$imageEntry.dataBase64 }
      } catch { Log-Note ("chat image local: " + $_.Exception.Message) }
    }
    $script:windowTurn = $true
    $script:tgReplyTo = 0
    $telegramText = if ([string]::IsNullOrWhiteSpace($text)) { '[imagen]' } else { $text }
    $script:tgUserTask = Send-Telegram ('🖥️ Ventana: ' + $telegramText)
    Set-ChanState 'pensando' $false
    Add-Typing
    Show-Bubble 'Déjame pensar…'
    $payload = @{ message = $text; confidence = 2 }
    if ($images.Count -gt 0) { $payload.images = $images }
    Log-Note ("chat send: textLen=" + $text.Length + " images=" + $images.Count)
    $json = ($payload | ConvertTo-Json -Compress -Depth 6)
    $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
    $script:pending = $script:http.PostAsync(($script:baseUrl + '/whale-maid-mascot/chat'), $content)
    $script:chatImages = @()
    Update-ChatThumbs
  } catch {
    Remove-Typing
    Add-ChatLine 'No pude conectar con Cala.' 'cala'
    Show-Bubble 'No pude conectar con Cala.'
    Log-Note ("chat send error: " + $_.Exception.Message)
  }
}


function Load-ChatHistory {
  try {
    if ($script:chatLoaded) { return }
    $script:chatLoaded = $true
    $raw = Invoke-RestMethod -Uri ($script:baseUrl + '/whale-maid-mascot/history') -Method Get -TimeoutSec 25
    Add-HistoryItems $raw.messages
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

$script:poll = New-Object System.Windows.Threading.DispatcherTimer
$script:poll.Interval = [TimeSpan]::FromMilliseconds(220)
$script:poll.Add_Tick({
  try {

    if ($null -ne $script:tgUserTask -and $script:tgUserTask.IsCompleted) {
      $uTask = $script:tgUserTask
      $script:tgUserTask = $null
      try {
        $uRaw = $uTask.Result.Content.ReadAsStringAsync().Result
        $uObj = $uRaw | ConvertFrom-Json
        if ($uObj.ok -and $uObj.result) { $script:tgReplyTo = [long]$uObj.result.message_id }
      } catch { }
    }

    if ($script:tgTasks.Count -gt 0) {
      $rest = @()
      foreach ($t in $script:tgTasks) {
        if (-not $t.IsCompleted) { $rest += $t; continue }
        try {
          $body = $t.Result.Content.ReadAsStringAsync().Result
          $obj = $body | ConvertFrom-Json
          Log-Note ("telegram send ok id=" + $obj.result.message_id)
        } catch { Log-Note ("telegram send error: " + $_.Exception.Message) }
      }
      $script:tgTasks = $rest
    }

    if ($null -ne $script:syncTask -and $script:syncTask.IsCompleted) {
      $sTask = $script:syncTask
      $script:syncTask = $null
      try {
        $sRaw = $sTask.Result.Content.ReadAsStringAsync().Result
        $sObj = $sRaw | ConvertFrom-Json
        Add-HistoryItems $sObj.messages
      } catch { }
    }

    if ($null -ne $script:pending -and $script:pending.IsCompleted) {
      $task = $script:pending
      $script:pending = $null
      Remove-Typing
      try {
        $raw = $task.Result.Content.ReadAsStringAsync().Result
        $obj = $raw | ConvertFrom-Json
        $line = [string]$obj.line
        if ([string]::IsNullOrWhiteSpace($line)) { $line = 'Me quedé sin palabras :(' }
        Add-ChatLine $line 'cala'
        if ($script:windowTurn) {
          $script:windowTurn = $false
          [void](Send-Telegram $line $script:tgReplyTo)
          $script:tgReplyTo = 0
        }
        Set-ChanState (State-FromMood $obj.mood) $false
        Revert-Later
        Show-Bubble $line
      } catch {
        Add-ChatLine 'No pude responder ahora mismo.' 'cala'
        Show-Bubble 'No pude responder ahora mismo.'
      }
    }
  } catch { }
})
$script:poll.Start()

# Mientras la ventana de conversación está abierta, relee el hilo compartido
# para que lo que llega por Telegram aparezca acá sin reabrir.
$script:sync = New-Object System.Windows.Threading.DispatcherTimer
$script:sync.Interval = [TimeSpan]::FromSeconds(3)
$script:sync.Add_Tick({
  try {
    if ($null -eq $script:chatWin) { return }
    if (-not $script:chatWin.IsVisible) { return }
    if ($null -ne $script:syncTask) { return }
    $script:syncTask = $script:http.GetAsync(($script:baseUrl + '/whale-maid-mascot/history'))
  } catch { }
})
$script:sync.Start()

# Mientras la ventana de conversación está abierta, relee el hilo compartido
# para que lo que llega por Telegram aparezca acá sin reabrir.
$script:sync = New-Object System.Windows.Threading.DispatcherTimer
$script:sync.Interval = [TimeSpan]::FromSeconds(3)
$script:sync.Add_Tick({
  try {
    if ($null -eq $script:chatWin) { return }
    if (-not $script:chatWin.IsVisible) { return }
    if ($null -ne $script:syncTask) { return }
    $script:syncTask = $script:http.GetAsync(($script:baseUrl + '/whale-maid-mascot/history'))
  } catch { }
})
$script:sync.Start()

# --- estado de ánimo automático: poll ligero al host (~2.5 s) ----------------
$script:moodPoll = New-Object System.Windows.Threading.DispatcherTimer
$script:moodPoll.Interval = [TimeSpan]::FromMilliseconds(2500)
$script:moodPoll.Add_Tick({
  try {
    if ((Get-Date) -lt $script:moodManualUntil) { return }
    if ($null -ne $script:moodTask) {
      if (-not $script:moodTask.IsCompleted) { return }
      $moodTask = $script:moodTask
      $script:moodTask = $null
      $moodRaw = $moodTask.Result.Content.ReadAsStringAsync().Result
      $moodData = $moodRaw | ConvertFrom-Json
      if ($null -ne $moodData -and $moodData.mood) { Apply-AutoMood ([string]$moodData.mood) }
    }
    if ($null -eq $script:moodTask) {
      $script:moodTask = $script:http.GetAsync(($script:baseUrl + '/whale-maid-mascot/mood'))
    }
  } catch {
    Log-Note ("mood poll: " + $_.Exception.Message)
    $script:moodTask = $null
  }
})
$script:moodPoll.Start()

function Show-ChatImageError([string]$message) {
  try {
    Log-Note ("chat image: " + $message)
    Add-ChatLine $message 'cala'
    Show-Bubble $message
  } catch { Log-Note ("chat image error: " + $_.Exception.Message) }
}

function Remove-ChatImage([int]$index) {
  try {
    if ($index -lt 0 -or $index -ge $script:chatImages.Count) { return }
    $rest = @()
    for ($i = 0; $i -lt $script:chatImages.Count; $i++) {
      if ($i -ne $index) { $rest += $script:chatImages[$i] }
    }
    $script:chatImages = $rest
    Update-ChatThumbs
  } catch { Log-Note ("chat image remove: " + $_.Exception.Message) }
}

function Update-ChatThumbs {
  try {
    if ($null -eq $script:chatThumbs -or $null -eq $script:chatThumbsHost) { return }
    $script:chatThumbs.Children.Clear()
    for ($i = 0; $i -lt $script:chatImages.Count; $i++) {
      $image = $script:chatImages[$i]
      $thumbGrid = New-Object System.Windows.Controls.Grid
      $thumbGrid.Margin = New-Object System.Windows.Thickness(2)
      $thumbGrid.Width = 42
      $thumbGrid.Height = 42
      $border = New-Object System.Windows.Controls.Border
      $border.CornerRadius = New-Object System.Windows.CornerRadius(8)
      $border.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(40, 255, 255, 255))
      $border.ClipToBounds = $true
      $picture = New-Object System.Windows.Controls.Image
      try {
        $bitmap = New-Object System.Windows.Media.Imaging.BitmapImage
        $stream = New-Object System.IO.MemoryStream(, [Convert]::FromBase64String([string]$image.dataBase64))
        $bitmap.BeginInit()
        $bitmap.StreamSource = $stream
        $bitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bitmap.DecodePixelWidth = 96
        $bitmap.EndInit()
        $bitmap.Freeze()
        $picture.Source = $bitmap
      } catch { Log-Note ("chat image thumb: " + $_.Exception.Message) }
      $picture.Stretch = [System.Windows.Media.Stretch]::UniformToFill
      $border.Child = $picture
      $thumbGrid.Children.Add($border) | Out-Null
      $remove = New-Object System.Windows.Controls.Button
      $remove.Content = '×'
      $remove.Tag = $i
      $remove.ToolTip = 'Quitar imagen'
      $remove.Width = 16
      $remove.Height = 16
      $remove.FontSize = 10
      $remove.Padding = New-Object System.Windows.Thickness(0)
      $remove.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
      $remove.VerticalAlignment = [System.Windows.VerticalAlignment]::Top
      $remove.Foreground = [System.Windows.Media.Brushes]::White
      $remove.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(200, 15, 23, 42))
      $remove.BorderThickness = New-Object System.Windows.Thickness(0)
      $remove.Add_Click({ param($btn, $ev) try { Remove-ChatImage ([int]$btn.Tag) } catch { Log-Note ("chat image remove: " + $_.Exception.Message) } })
      $thumbGrid.Children.Add($remove) | Out-Null
      $script:chatThumbs.Children.Add($thumbGrid) | Out-Null
    }
    $script:chatThumbsHost.Visibility = if ($script:chatImages.Count -gt 0) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  } catch { Log-Note ("chat image thumbs: " + $_.Exception.Message) }
}

function Test-ImagePath([string]$path) {
  try {
    if ([string]::IsNullOrWhiteSpace($path)) { return $false }
    $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
    return @('.png', '.jpg', '.jpeg', '.webp', '.gif') -contains $ext
  } catch { return $false }
}

# Ctrl+V: imágenes del portapapeles (Bitmap o lista de archivos copiada del
# explorador). Devuelve 'image'/'files' si consumió el paste, '' para dejarlo
# pasar como texto. Siempre deja traza en cala-window.log.
function Paste-ChatClipboard {
  try {
    $formats = @()
    try {
      $data = [System.Windows.Clipboard]::GetDataObject()
      if ($null -ne $data) { $formats = @($data.GetFormats()) }
    } catch { }
    Log-Note ("clipboard paste: formats=" + ($formats -join ','))

    $hasImage = $false
    try { $hasImage = [System.Windows.Clipboard]::ContainsImage() } catch { }
    if ($hasImage) {
      $image = [System.Windows.Clipboard]::GetImage()
      if ($null -ne $image) {
        $dir = Join-Path $env:TEMP 'cala-paste'
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $file = Join-Path $dir ('pegado-' + (Get-Date -Format 'HHmmssfff') + '.png')
        $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
        [void]$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($image))
        $stream = [System.IO.File]::Create($file)
        try { $encoder.Save($stream) } finally { $stream.Close() }
        Log-Note ("clipboard paste: image -> " + $file + " bytes=" + (New-Object System.IO.FileInfo($file)).Length)
        Add-ChatImage $file
        Start-Sleep -Milliseconds 150
        try { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue } catch { }
        return 'image'
      }
    }

    $hasFiles = $false
    try { $hasFiles = [System.Windows.Clipboard]::ContainsFileDropList() } catch { }
    if ($hasFiles) {
      $paths = @([System.Windows.Clipboard]::GetFileDropList())
      $added = 0
      foreach ($path in $paths) {
        if (Test-ImagePath ([string]$path)) { Add-ChatImage ([string]$path); $added++ }
      }
      Log-Note ("clipboard paste: files=" + $paths.Count + " images=" + $added)
      if ($added -gt 0) { return 'files' }
    }

    Log-Note 'clipboard paste: no image/files, letting text paste'
    return ''
  } catch {
    Log-Note ("clipboard paste error: " + $_.Exception.Message)
    return ''
  }
}

function Add-ChatImage([string]$path) {
  try {
    if ([string]::IsNullOrWhiteSpace($path)) { return }
    $full = [System.IO.Path]::GetFullPath($path)
    if (-not (Test-Path -LiteralPath $full)) { Show-ChatImageError 'No encontré esa imagen.'; return }
    $extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $mime = switch ($extension) {
      '.png' { 'image/png' }
      '.jpg' { 'image/jpeg' }
      '.jpeg' { 'image/jpeg' }
      '.webp' { 'image/webp' }
      '.gif' { 'image/gif' }
      default { $null }
    }
    if ($null -eq $mime) { Show-ChatImageError 'Formato no soportado: usá png, jpg, webp o gif.'; return }
    $info = New-Object System.IO.FileInfo($full)
    if ($info.Length -le 0) { Show-ChatImageError 'La imagen está vacía.'; return }
    if ($info.Length -gt 6MB) { Show-ChatImageError 'La imagen es muy grande (máximo 6 MB).'; return }
    if ($script:chatImages.Count -ge 3) { Show-ChatImageError 'Máximo 3 imágenes por mensaje.'; return }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $script:chatImages += [pscustomobject]@{
      mimeType = $mime
      mediaType = $mime
      dataBase64 = [Convert]::ToBase64String($bytes)
      name = [System.IO.Path]::GetFileName($full)
    }
    Log-Note ("chat image added: " + [System.IO.Path]::GetFileName($full) + " bytes=" + $info.Length + " total=" + $script:chatImages.Count)
    Update-ChatThumbs
  } catch {
    Log-Note ("chat image add: " + $_.Exception.Message)
    Show-ChatImageError 'No pude leer la imagen.'
  }
}

function Pick-ChatImage {
  try {
    $dialog = New-Object Microsoft.Win32.OpenFileDialog
    $dialog.Title = 'Adjuntar imagen para Cala'
    $dialog.Filter = 'Imágenes|*.png;*.jpg;*.jpeg;*.webp;*.gif'
    $dialog.Multiselect = $false
    if ($dialog.ShowDialog() -eq $true) { Add-ChatImage $dialog.FileName }
  } catch { Log-Note ("chat image pick: " + $_.Exception.Message) }
}


# --- ventana de conversación ------------------------------------------------
function Get-ChatWindow {
  try {
    if ($null -ne $script:chatWin) { return $script:chatWin }

    $cw = New-Object System.Windows.Window
    $cw.WindowStyle = [System.Windows.WindowStyle]::None
    $cw.AllowsTransparency = $true
    $cw.Background = [System.Windows.Media.Brushes]::Transparent
    $cw.ShowInTaskbar = $false
    $cw.Topmost = (-not $NoTopMost)
    $cw.Width = 356
    $cw.Height = 486
    $cw.Left = $script:win.Left - 372
    $cw.Top = $script:win.Top
    if ($cw.Left -lt $area.Left + 8) { $cw.Left = $script:win.Left + $script:win.Width + 16 }
    if ($cw.Top -lt $area.Top + 8) { $cw.Top = $area.Top + 16 }
    if ($cw.Top + $cw.Height -gt $area.Bottom) { $cw.Top = $area.Bottom - $cw.Height - 8 }

    $shell = New-Object System.Windows.Controls.Border
    $shell.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(246, 20, 29, 42))
    $shell.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(52, 255, 255, 255))
    $shell.BorderThickness = New-Object System.Windows.Thickness(1)
    $shell.CornerRadius = New-Object System.Windows.CornerRadius(16)
    $shell.Padding = New-Object System.Windows.Thickness(0)
    $cardShadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $cardShadow.BlurRadius = 26
    $cardShadow.ShadowDepth = 8
    $cardShadow.Opacity = 0.45
    $cardShadow.Color = [System.Windows.Media.Colors]::Black
    $shell.Effect = $cardShadow

    $layout = New-Object System.Windows.Controls.Grid
    $r0 = New-Object System.Windows.Controls.RowDefinition
    $r0.Height = New-Object System.Windows.GridLength(56)
    $r1 = New-Object System.Windows.Controls.RowDefinition
    $r1.Height = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    $r2 = New-Object System.Windows.Controls.RowDefinition
    $r2.Height = New-Object System.Windows.GridLength(64)
    $rThumbs = New-Object System.Windows.Controls.RowDefinition
    $rThumbs.Height = New-Object System.Windows.GridLength(0, [System.Windows.GridUnitType]::Auto)
    $rSplit = New-Object System.Windows.Controls.RowDefinition
    $rSplit.Height = New-Object System.Windows.GridLength(0, [System.Windows.GridUnitType]::Auto)
    # Altura del input recordada en ~/.dsh/whale-maid.json (chatInputHeight).
    $initialInputHeight = 64
    try {
      $savedCfg = Read-Config
      if ($null -ne $savedCfg -and $null -ne $savedCfg.chatInputHeight) { $initialInputHeight = [int]$savedCfg.chatInputHeight }
    } catch { }
    if ($initialInputHeight -lt 64) { $initialInputHeight = 64 }
    if ($initialInputHeight -gt 260) { $initialInputHeight = 260 }
    $r2.Height = New-Object System.Windows.GridLength($initialInputHeight)
    $script:inputRow = $r2
    $script:dragStartY = 0.0
    $script:dragStartHeight = [double]$initialInputHeight
    [void]$layout.RowDefinitions.Add($r0)
    [void]$layout.RowDefinitions.Add($r1)
    [void]$layout.RowDefinitions.Add($rThumbs)
    [void]$layout.RowDefinitions.Add($rSplit)
    [void]$layout.RowDefinitions.Add($r2)


    # header: nombre + subtítulo a la izquierda, cerrar a la derecha
    $header = New-Object System.Windows.Controls.Grid
    $header.Margin = New-Object System.Windows.Thickness(16, 0, 10, 0)
    $hc1 = New-Object System.Windows.Controls.ColumnDefinition
    $hc1.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    $hc2 = New-Object System.Windows.Controls.ColumnDefinition
    $hc2.Width = New-Object System.Windows.GridLength(0, [System.Windows.GridUnitType]::Auto)
    [void]$header.ColumnDefinitions.Add($hc1)
    [void]$header.ColumnDefinitions.Add($hc2)

    $titles = New-Object System.Windows.Controls.StackPanel
    $titles.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $nameText = New-Object System.Windows.Controls.TextBlock
    $nameText.Text = 'Cala'
    $nameText.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI Semibold")
    $nameText.FontSize = 14
    $nameText.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(248, 250, 252))
    [void]$titles.Children.Add($nameText)
    [System.Windows.Controls.Grid]::SetColumn($titles, 0)
    [void]$header.Children.Add($titles)

    $close = New-Object System.Windows.Controls.Button
    $close.Content = '✕'
    $close.Style = $script:buttonStyle
    $close.FontSize = 12
    $close.Padding = New-Object System.Windows.Thickness(12, 6, 12, 6)
    $close.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $close.Add_Click({ param($s, $e) try { $script:chatWin.Hide() } catch { } })
    [System.Windows.Controls.Grid]::SetColumn($close, 1)
    [void]$header.Children.Add($close)
    [System.Windows.Controls.Grid]::SetRow($header, 0)
    [void]$layout.Children.Add($header)
    $header.Add_MouseLeftButtonDown({ param($s, $e) try { $script:chatWin.DragMove() } catch { } })

    # historial
    $script:chatScroll = New-Object System.Windows.Controls.ScrollViewer
    $script:chatScroll.VerticalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Auto
    $script:chatScroll.HorizontalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Disabled
    $script:chatScroll.Margin = New-Object System.Windows.Thickness(14, 4, 10, 6)
    $script:chatStack = New-Object System.Windows.Controls.StackPanel
    $script:chatScroll.Content = $script:chatStack
    [System.Windows.Controls.Grid]::SetRow($script:chatScroll, 1)
    [void]$layout.Children.Add($script:chatScroll)

    # entrada: una sola fila, sin solapamientos
    $inputShell = New-Object System.Windows.Controls.Border
    $inputShell.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(26, 255, 255, 255))
    $inputShell.CornerRadius = New-Object System.Windows.CornerRadius(12)
    $inputShell.Margin = New-Object System.Windows.Thickness(12, 4, 12, 14)
    $inputGrid = New-Object System.Windows.Controls.Grid
    $ic1 = New-Object System.Windows.Controls.ColumnDefinition
    $ic1.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
    $ic2 = New-Object System.Windows.Controls.ColumnDefinition
    $ic2.Width = New-Object System.Windows.GridLength(0, [System.Windows.GridUnitType]::Auto)
    $ic3 = New-Object System.Windows.Controls.ColumnDefinition
    $ic3.Width = New-Object System.Windows.GridLength(0, [System.Windows.GridUnitType]::Auto)
    [void]$inputGrid.ColumnDefinitions.Add($ic1)
    [void]$inputGrid.ColumnDefinitions.Add($ic2)
    [void]$inputGrid.ColumnDefinitions.Add($ic3)

    $box = New-Object System.Windows.Controls.TextBox
    $box.Background = [System.Windows.Media.Brushes]::Transparent
    $box.BorderThickness = New-Object System.Windows.Thickness(0)
    $box.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(241, 245, 249))
    $box.CaretBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(125, 211, 252))
    $box.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
    $box.FontSize = 12
    $box.Margin = New-Object System.Windows.Thickness(10, 0, 6, 0)
    $box.Padding = New-Object System.Windows.Thickness(0)
    $box.VerticalContentAlignment = [System.Windows.VerticalAlignment]::Center
    $box.AcceptsReturn = $true
    $box.TextWrapping = [System.Windows.TextWrapping]::Wrap
    [System.Windows.Controls.Grid]::SetColumn($box, 0)
    [void]$inputGrid.Children.Add($box)

    $hint = New-Object System.Windows.Controls.TextBlock
    $hint.Text = 'Escríbele a Cala…'
    $hint.FontFamily = New-Object System.Windows.Media.FontFamily("Segoe UI")
    $hint.FontSize = 12
    $hint.Foreground = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(100, 116, 139))
    $hint.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $hint.Margin = New-Object System.Windows.Thickness(11, 0, 0, 0)
    $hint.IsHitTestVisible = $false
    [System.Windows.Controls.Grid]::SetColumn($hint, 0)
    [void]$inputGrid.Children.Add($hint)

    $attach = New-Object System.Windows.Controls.Button
    $attach.Content = '📎'
    $attach.Style = $script:buttonStyle
    $attach.FontSize = 13
    $attach.Padding = New-Object System.Windows.Thickness(9, 6, 9, 6)
    $attach.Margin = New-Object System.Windows.Thickness(0, 0, 2, 0)
    $attach.ToolTip = 'Adjuntar imagen (png, jpg, webp, gif)'
    $attach.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [System.Windows.Controls.Grid]::SetColumn($attach, 1)
    [void]$inputGrid.Children.Add($attach)

    $send = New-Object System.Windows.Controls.Button
    $send.Content = '➤'
    $send.Style = $script:buttonStyle
    $send.FontSize = 13
    $send.Padding = New-Object System.Windows.Thickness(12, 6, 12, 6)
    $send.Margin = New-Object System.Windows.Thickness(0, 0, 4, 0)
    $send.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    [System.Windows.Controls.Grid]::SetColumn($send, 2)
    [void]$inputGrid.Children.Add($send)

    # tira de miniaturas de las imágenes elegidas (oculta si no hay ninguna)
    $script:chatThumbs = New-Object System.Windows.Controls.WrapPanel
    $thumbsBorder = New-Object System.Windows.Controls.Border
    $thumbsBorder.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(20, 255, 255, 255))
    $thumbsBorder.CornerRadius = New-Object System.Windows.CornerRadius(10)
    $thumbsBorder.Margin = New-Object System.Windows.Thickness(12, 0, 12, 4)
    $thumbsBorder.Padding = New-Object System.Windows.Thickness(4)
    $thumbsBorder.Child = $script:chatThumbs
    $thumbsBorder.Visibility = [System.Windows.Visibility]::Collapsed
    $script:chatThumbsHost = $thumbsBorder
    [System.Windows.Controls.Grid]::SetRow($thumbsBorder, 2)
    [void]$layout.Children.Add($thumbsBorder)

    $resizeBar = New-Object System.Windows.Controls.Border
    $resizeBar.Height = 10
    $resizeBar.Margin = New-Object System.Windows.Thickness(12, 0, 12, 0)
    $resizeBar.Background = [System.Windows.Media.Brushes]::Transparent
    $resizeBar.Cursor = [System.Windows.Input.Cursors]::SizeNS
    $resizeBar.ToolTip = 'Arrastrar para cambiar la altura del mensaje'
    $grip = New-Object System.Windows.Controls.Border
    $grip.Height = 3
    $grip.CornerRadius = New-Object System.Windows.CornerRadius(2)
    $grip.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(70, 148, 163, 184))
    $grip.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $resizeBar.Child = $grip
    $resizeBar.Add_MouseLeftButtonDown({
      param($rs, $re)
      try {
        $script:dragStartY = $re.GetPosition($script:chatWin).Y
        $script:dragStartHeight = [double]$script:inputRow.Height.Value
        [void]$rs.CaptureMouse()
      } catch { Log-Note ("input-resize down: " + $_.Exception.Message) }
    })
    $resizeBar.Add_MouseMove({
      param($rs, $re)
      try {
        if (-not $rs.IsMouseCaptured) { return }
        $dy = $re.GetPosition($script:chatWin).Y - $script:dragStartY
        $newHeight = $script:dragStartHeight - $dy
        if ($newHeight -lt 64) { $newHeight = 64 }
        if ($newHeight -gt 260) { $newHeight = 260 }
        $script:inputRow.Height = New-Object System.Windows.GridLength($newHeight)
      } catch { Log-Note ("input-resize move: " + $_.Exception.Message) }
    })
    $resizeBar.Add_MouseLeftButtonUp({
      param($rs, $re)
      try {
        if ($rs.IsMouseCaptured) { [void]$rs.ReleaseMouseCapture() }
        $height = [int]$script:inputRow.Height.Value
        Save-Config @{ chatInputHeight = $height }
        Log-Note ("input-resize saved height=" + $height)
      } catch { Log-Note ("input-resize up: " + $_.Exception.Message) }
    })
    [System.Windows.Controls.Grid]::SetRow($resizeBar, 3)
    [void]$layout.Children.Add($resizeBar)

    $inputShell.Child = $inputGrid
    [System.Windows.Controls.Grid]::SetRow($inputShell, 4)
    [void]$layout.Children.Add($inputShell)


    $send.Add_Click({ param($s, $e) try { $value = $script:chatBox.Text; $script:chatBox.Text = ''; Send-Chat $value; $script:chatBox.Focus() } catch { Log-Note ("chat send click: " + $_.Exception.Message) } })
    $attach.Add_Click({ param($s, $e) try { Pick-ChatImage } catch { Log-Note ("chat attach: " + $_.Exception.Message) } })
        $box.Add_PreviewKeyDown({
      param($s, $e)
      try {
        $key = $e.Key
        if ($key -eq [System.Windows.Input.Key]::System) { $key = $e.SystemKey }
        $ctrlDown = [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::LeftCtrl) -or [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::RightCtrl)
        if ($ctrlDown -and $key -eq [System.Windows.Input.Key]::V) {
          $pasteResult = Paste-ChatClipboard
          if ($pasteResult -ne '') {
            Log-Note ("chat-key: paste-detected handled=" + $pasteResult)
            $e.Handled = $true
            return
          }
          Log-Note 'chat-key: paste-detected handled=text'
        }
        if ($key -eq [System.Windows.Input.Key]::Enter -or $key -eq [System.Windows.Input.Key]::Return) {
          $mods = [System.Windows.Input.Keyboard]::Modifiers
          $shift = [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::LeftShift) -or [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::RightShift)
          $ctrl = [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::LeftCtrl) -or [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::RightCtrl)
          $alt = [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::LeftAlt) -or [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::RightAlt)
          $win = [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::LWin) -or [System.Windows.Input.Keyboard]::IsKeyDown([System.Windows.Input.Key]::RWin)
          $branch = if ($shift -or $ctrl -or $alt -or $win) { 'newline' } else { 'send' }
          $e.Handled = $true
          Log-Note ("chat-key: fired key=" + $e.Key + " systemKey=" + $e.SystemKey + " mods=" + $mods + " shift=" + $shift + " ctrl=" + $ctrl + " alt=" + $alt + " win=" + $win + " branch=" + $branch)
          if ($branch -eq 'newline') {
            $tb = $s
            $text = [string]$tb.Text
            $start = [int]$tb.SelectionStart
            $length = [int]$tb.SelectionLength
            if ($start -lt 0) { $start = 0 }
            if ($start -gt $text.Length) { $start = $text.Length }
            if ($start + $length -gt $text.Length) { $length = $text.Length - $start }
            $before = if ($start -gt 0) { $text.Substring(0, $start) } else { '' }
            $after = if ($start + $length -lt $text.Length) { $text.Substring($start + $length) } else { '' }
            $tb.Text = $before + [Environment]::NewLine + $after
            $tb.SelectionStart = $start + [Environment]::NewLine.Length
            $tb.SelectionLength = 0
            $tb.Focus()
          } else {
            $value = [string]$s.Text
            $s.Text = ''
            Send-Chat $value
            $s.Focus()
          }
        } elseif ($key -eq [System.Windows.Input.Key]::Escape) {
          $e.Handled = $true
          Log-Note 'chat-key: escape'
          $script:chatWin.Hide()
        }
      } catch {
        Log-Note ("chat-key error: " + $_.Exception.Message)
      }
    })
    try {
      $pasteHandler = [System.Windows.DataObjectPastingEventHandler]{
        param($ps, $pe)
        try {
          $data = $pe.DataObject
          $formats = @()
          if ($null -ne $data) { $formats = @($data.GetFormats()) }
          $hasImage = $false
          $hasFiles = $false
          try { $hasImage = [System.Windows.Clipboard]::ContainsImage() } catch { }
          try { $hasFiles = [System.Windows.Clipboard]::ContainsFileDropList() } catch { }
          Log-Note ("clipboard pasting: formats=" + ($formats -join ',') + " image=" + $hasImage + " files=" + $hasFiles)
          if ($hasImage -or $hasFiles) {
            $pasteResult = Paste-ChatClipboard
            if ($pasteResult -ne '') {
              $pe.CancelCommand()
              $pe.Handled = $true
            }
          }
        } catch { Log-Note ("clipboard pasting error: " + $_.Exception.Message) }
      }
      $box.AddHandler([System.Windows.DataObject]::PastingEvent, $pasteHandler, $true)
    } catch { Log-Note ("clipboard pasting setup: " + $_.Exception.Message) }
    $box.Add_TextChanged({
      try {
        if ([string]::IsNullOrWhiteSpace($script:chatBox.Text)) { $script:chatHint.Visibility = [System.Windows.Visibility]::Visible }
        else { $script:chatHint.Visibility = [System.Windows.Visibility]::Collapsed }
      } catch { }
    })

    $shell.Child = $layout
    $cw.Content = $shell
    try {
      $cw.AllowDrop = $true
      $cw.Add_DragEnter({ param($ds, $de) try { if ($de.Data -and $de.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) { $de.Effects = [System.Windows.DragDropEffects]::Copy; $de.Handled = $true } } catch { } })
      $cw.Add_DragOver({ param($ds, $de) try { if ($de.Data -and $de.Data.GetDataPresent([System.Windows.DataFormats]::FileDrop)) { $de.Effects = [System.Windows.DragDropEffects]::Copy; $de.Handled = $true } } catch { } })
      $cw.Add_Drop({ param($ds, $de) try { $files = $de.Data.GetData([System.Windows.DataFormats]::FileDrop); foreach ($f in @($files)) { Add-ChatImage ([string]$f) }; $de.Handled = $true } catch { Log-Note ("chat drop error: " + $_.Exception.Message) } })
    } catch { Log-Note ("chat dragdrop setup: " + $_.Exception.Message) }
    $cw.Add_KeyDown({
      param($s, $e)
      try {
        if ($e.Key -eq [System.Windows.Input.Key]::Escape) { $script:chatWin.Hide() }
      } catch { }
    })
    $cw.Add_Closed({ try { $script:chatWin = $null } catch { } })

    $script:chatWin = $cw
    $script:chatBox = $box
    $script:chatHint = $hint
    return $cw
  } catch {
    return $null
  }
}

function Show-ChatWindow {
  try {
    $cw = Get-ChatWindow
    if ($null -eq $cw) { return }
    if (-not $cw.IsVisible) { $cw.Show() }
    $cw.Activate()
    try { $script:chatBox.Focus() } catch { }
    Load-ChatHistory
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Hide-ChatWindow {
  try {
    if ($null -ne $script:chatWin) { $script:chatWin.Hide() }
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

# --- menú: tarjeta oscura con pocas acciones --------------------------------
function Get-Popup {
  try {
    if ($null -ne $script:menuPopup) { return }
    $popup = New-Object System.Windows.Controls.Primitives.Popup
    $popup.StaysOpen = $false
    $popup.AllowsTransparency = $true
    $popup.Placement = [System.Windows.Controls.Primitives.PlacementMode]::Absolute
    $card = New-Object System.Windows.Controls.Border
    $card.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(248, 20, 29, 42))
    $card.BorderBrush = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(52, 255, 255, 255))
    $card.BorderThickness = New-Object System.Windows.Thickness(1)
    $card.CornerRadius = New-Object System.Windows.CornerRadius(14)
    $card.Padding = New-Object System.Windows.Thickness(4)
    $card.Width = 200
    $card.MinWidth = 176
    $card.MaxWidth = 224
    $menuShadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $menuShadow.BlurRadius = 24
    $menuShadow.ShadowDepth = 6
    $menuShadow.Opacity = 0.45
    $menuShadow.Color = [System.Windows.Media.Colors]::Black
    $card.Effect = $menuShadow
    $panel = New-Object System.Windows.Controls.StackPanel
    $menuScroll = New-Object System.Windows.Controls.ScrollViewer
    $menuScroll.VerticalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Auto
    $menuScroll.HorizontalScrollBarVisibility = [System.Windows.Controls.ScrollBarVisibility]::Disabled
    $menuScroll.MaxHeight = 420
    $menuScroll.Content = $panel
    $card.Child = $menuScroll
    $popup.Child = $card
    $script:menuPopup = $popup
    $script:menuPanel = $panel
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Show-Menu {
  try {
    Get-Popup
    if ($null -eq $script:menuPopup) { return }
    [void]$script:menuPanel.Children.Clear()

    [void]$script:menuPanel.Children.Add((New-MenuButton 'Hablar con Cala' { param($s, $e) try { $script:menuPopup.IsOpen = $false; Show-ChatWindow } catch { } }))
    [void]$script:menuPanel.Children.Add((New-MenuButton 'Traer DSH al frente' { param($s, $e) try { $script:menuPopup.IsOpen = $false; Focus-Harness } catch { } }))
    [void]$script:menuPanel.Children.Add((New-Separator))

    [void]$script:menuPanel.Children.Add((New-Label 'ESTADO'))
    $stateRow = New-Object System.Windows.Controls.WrapPanel
    $stateRow.Margin = New-Object System.Windows.Thickness(8, 0, 0, 6)
    foreach ($key in $script:chanStates.Keys) {
      $name = if ($script:chanLabels.ContainsKey($key)) { $script:chanLabels[$key] } else { $key }
      $chip = New-Chip $name $key ($key -eq $script:currentState) { param($s, $e) try { $script:menuPopup.IsOpen = $false; Set-ChanState ([string]$s.Tag) $true } catch { } }
      [void]$stateRow.Children.Add($chip)
    }
    [void]$script:menuPanel.Children.Add($stateRow)

    [void]$script:menuPanel.Children.Add((New-Label 'VISTAS'))
    $viewRow = New-Object System.Windows.Controls.WrapPanel
    $viewRow.Margin = New-Object System.Windows.Thickness(8, 0, 0, 2)
    foreach ($key in $script:chanViews.Keys) {
      $name = if ($script:chanLabels.ContainsKey($key)) { $script:chanLabels[$key] } else { $key }
      $chip = New-Chip $name $key ($key -eq $script:currentState) { param($s, $e) try { $script:menuPopup.IsOpen = $false; Set-ChanState ([string]$s.Tag) $true } catch { } }
      [void]$viewRow.Children.Add($chip)
    }
    [void]$script:menuPanel.Children.Add($viewRow)

    [void]$script:menuPanel.Children.Add((New-Label 'TAMAÑO'))
    $sizeRow = New-Object System.Windows.Controls.WrapPanel
    $sizeRow.Margin = New-Object System.Windows.Thickness(8, 0, 0, 2)
    foreach ($w in 180, 260, 340, 440) {
      $chip = New-Chip ("$w") ([string]$w) ([int]$script:win.Width -eq $w) { param($s, $e) try { $script:menuPopup.IsOpen = $false; Resize-Sprite ([int]$s.Tag) } catch { } }
      [void]$sizeRow.Children.Add($chip)
    }
    [void]$script:menuPanel.Children.Add($sizeRow)
    [void]$script:menuPanel.Children.Add((New-Separator))

    [void]$script:menuPanel.Children.Add((New-MenuButton 'Ocultar (queda en la bandeja)' { param($s, $e) try { $script:menuPopup.IsOpen = $false; Hide-Cala } catch { } }))
    [void]$script:menuPanel.Children.Add((New-MenuButton 'Desactivar modo escritorio' { param($s, $e) try { $script:menuPopup.IsOpen = $false; Save-Config @{ desktopMode = $false }; $script:win.Close() } catch { } }))

    $pt = $script:win.PointToScreen([System.Windows.Input.Mouse]::GetPosition($script:win))
    $script:menuPopup.HorizontalOffset = [math]::Max(0.0, ($pt.X - 24))
    $script:menuPopup.VerticalOffset = [math]::Max(0.0, ($pt.Y - 12))
    $script:menuPopup.IsOpen = $true
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Hide-Cala {
  try {
    $script:win.Hide()
    if ($null -ne $script:tray) {
      $script:tray.ShowBalloonTip(1800, 'Cala', 'Sigo aquí, en la bandeja. Doble clic para volver.', [System.Windows.Forms.ToolTipIcon]::None)
    }
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

function Show-Cala {
  try {
    $script:win.Show()
    $script:win.Activate()
  } catch { Log-Note ("history error: " + $_.Exception.Message) }
}

# --- bandeja: la forma de recuperarla cuando está oculta --------------------
$script:tray = New-Object System.Windows.Forms.NotifyIcon
$script:tray.Text = 'Cala'
$script:tray.Icon = [System.Drawing.SystemIcons]::Application
$trayMenu = New-Object System.Windows.Forms.ContextMenuStrip
$showItem = $trayMenu.Items.Add('Mostrar a Cala')
$showItem.Add_Click({ try { Show-Cala } catch { } })
$chatItem = $trayMenu.Items.Add('Hablar con Cala')
$chatItem.Add_Click({ try { Show-ChatWindow } catch { } })
$exitItem = $trayMenu.Items.Add('Salir')
$exitItem.Add_Click({ try { $script:win.Close() } catch { } })
$script:tray.ContextMenuStrip = $trayMenu
$script:tray.Add_MouseDoubleClick({ try { Show-Cala } catch { } })
$script:tray.Visible = $true

# --- mouse y teclado --------------------------------------------------------
$script:pressPoint = $null
$script:pressedAt = [DateTime]::MaxValue
$script:dragged = $false
$script:lastClick = [DateTime]::MinValue

$script:win.Add_MouseLeftButtonDown({
  # Cualquier excepción acá cierra el proceso entero (exit 1), así que todo va
  # envuelto: un clic nunca debe poder tumbar a la mascota.
  try {
    $script:pressPoint = [System.Windows.Input.Mouse]::GetPosition($script:win)
    $script:pressedAt = [DateTime]::Now
  } catch { $script:pressPoint = $null }
  $script:dragged = $false
})

$script:win.Add_MouseMove({
  try {
    if ($null -eq $script:pressPoint) { return }
    if ([System.Windows.Input.Mouse]::LeftButton -ne [System.Windows.Input.MouseButtonState]::Pressed) { return }
    # Ignora micro-movimientos de la activación: arrastrar exige 6 px y 90 ms.
    if (([DateTime]::Now - $script:pressedAt).TotalMilliseconds -lt 90) { return }
    $p = [System.Windows.Input.Mouse]::GetPosition($script:win)
    if (([math]::Abs($p.X - $script:pressPoint.X) + [math]::Abs($p.Y - $script:pressPoint.Y)) -gt 6) {
      $script:dragged = $true
      $script:pressPoint = $null
      $script:win.DragMove()
      Save-Position
    }
  } catch { $script:pressPoint = $null }
})

$script:win.Add_MouseLeftButtonUp({
  try {
    $wasDrag = $script:dragged
    $script:pressPoint = $null
    $script:dragged = $false
    if ($wasDrag) { return }
    $now = [DateTime]::Now
    if (($now - $script:lastClick).TotalMilliseconds -lt 380) {
      $script:lastClick = [DateTime]::MinValue
      Show-ChatWindow
      return
    }
    $script:lastClick = $now
    Hop
    Show-Bubble ($script:lines[(Get-Random -Minimum 0 -Maximum $script:lines.Count)])
  } catch {
    # silencio deliberado: la mascota sigue viva aunque falle una reacción
  }
})

$script:win.Add_MouseRightButtonUp({
  try { Show-Menu } catch { }
})

$script:win.Add_Closed({
  try {
    $script:bubbleTimer.Stop()
    $script:poll.Stop()
    if ($null -ne $script:tray) { $script:tray.Visible = $false; $script:tray.Dispose() }
    if ($null -ne $script:chatWin) { $script:chatWin.Close() }
    if ($null -ne $script:http) { $script:http.Dispose() }
  } catch { }
})

# --- run --------------------------------------------------------------------
$app = New-Object System.Windows.Application
$app.ShutdownMode = [System.Windows.ShutdownMode]::OnMainWindowClose
[void]$app.Run($script:win)
