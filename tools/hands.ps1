param(
  [Parameter(Position=0)][string]$Cmd = 'help',
  [Parameter(Position=1)][string]$A1,
  [Parameter(Position=2)][string]$A2,
  [Parameter(Position=3)][string]$A3,
  [Parameter(Position=4)][string]$A4,
  [string]$Out,
  [string]$Guard = "",
  [switch]$Force,
  [switch]$Double,
  [switch]$Right,
  [switch]$Middle,
  [int]$Times = 1
)

# hands.ps1 - manos de la mascota en Windows: ventanas, captura, mouse, teclado.
# Coordenadas fisicas (proceso DPI-aware). Requiere -ExecutionPolicy Bypass.

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public MOUSEINPUT mi; [FieldOffset(8)] public KEYBDINPUT ki; }

  public class WinInfo {
    public IntPtr hwnd; public string title; public string cls; public uint pid;
    public int x, y, w, h; public bool visible;
    public long area { get { return (long)w * h; } }
  }

  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  public const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;
  public const uint MOVE = 0x0001, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000;
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010, MIDDLEDOWN = 0x0020, MIDDLEUP = 0x0040, WHEEL = 0x0800;
  public const uint KEYUP = 0x0002, UNICODE = 0x0004, EXTENDED = 0x0001;

  public static int[] VScreen() {
    return new int[] { GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
                       GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN) };
  }

  static List<WinInfo> _acc = null;

  static bool Cb(IntPtr h, IntPtr l) {
    StringBuilder t = new StringBuilder(512); GetWindowTextW(h, t, 512);
    StringBuilder c = new StringBuilder(256); GetClassNameW(h, c, 256);
    RECT r; GetWindowRect(h, out r);
    uint pid; GetWindowThreadProcessId(h, out pid);
    WinInfo i = new WinInfo();
    i.hwnd = h; i.title = t.ToString(); i.cls = c.ToString(); i.pid = pid;
    i.x = r.Left; i.y = r.Top; i.w = r.Right - r.Left; i.h = r.Bottom - r.Top;
    i.visible = IsWindowVisible(h);
    _acc.Add(i);
    return true;
  }

  public static WinInfo[] AllWindows() {
    _acc = new List<WinInfo>();
    EnumWindows(Cb, IntPtr.Zero);
    return _acc.ToArray();
  }

  static INPUT Mouse(int x, int y, uint flags, int data) {
    int[] v = VScreen();
    INPUT i = new INPUT(); i.type = 0;
    long nx = (long)Math.Round((x - v[0]) * 65535.0 / Math.Max(1, v[2] - 1));
    long ny = (long)Math.Round((y - v[1]) * 65535.0 / Math.Max(1, v[3] - 1));
    i.mi.dx = (int)nx; i.mi.dy = (int)ny;
    i.mi.mouseData = (uint)data;
    i.mi.dwFlags = flags | ABSOLUTE | VIRTUALDESK;
    return i;
  }

  public static string MoveTo(int x, int y) {
    bool ok = SetCursorPos(x, y);
    POINT p; GetCursorPos(out p);
    return "move=" + ok + " cursor=" + p.X + "," + p.Y;
  }

  // Click sin coordenadas: el sistema ya dejo el cursor puesto con SetCursorPos.
  static INPUT Btn(uint flags) {
    INPUT i = new INPUT(); i.type = 0; i.mi.dwFlags = flags; return i;
  }

  public static string Click(int x, int y, int btn, int times) {
    uint d, u;
    if (btn == 1) { d = RIGHTDOWN; u = RIGHTUP; }
    else if (btn == 2) { d = MIDDLEDOWN; u = MIDDLEUP; }
    else { d = LEFTDOWN; u = LEFTUP; }
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    string r = "";
    for (int t = 0; t < times; t++) {
      INPUT[] a = new INPUT[] { Btn(d), Btn(u) };
      r += SendInput(2, a, Marshal.SizeOf(typeof(INPUT))) + "/";
      System.Threading.Thread.Sleep(90);
    }
    return "click=" + r;
  }

  public static string Wheel(int x, int y, int notches) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(40);
    INPUT w = Btn(WHEEL); w.mi.mouseData = (uint)(notches * -120);
    INPUT[] a = new INPUT[] { w };
    uint ok = SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
    return "wheel=" + ok;
  }

  public static string Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1);
    System.Threading.Thread.Sleep(140);
    INPUT[] a = new INPUT[] { Btn(LEFTDOWN) };
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(160);
    int steps = 16;
    for (int s = 1; s <= steps; s++) {
      SetCursorPos(x1 + (x2 - x1) * s / steps, y1 + (y2 - y1) * s / steps);
      System.Threading.Thread.Sleep(22);
    }
    System.Threading.Thread.Sleep(140);
    INPUT[] b = new INPUT[] { Btn(LEFTUP) };
    SendInput(1, b, Marshal.SizeOf(typeof(INPUT)));
    return "drag ok";
  }

  static INPUT Key(ushort vk, uint flags) {
    INPUT i = new INPUT(); i.type = 1;
    i.ki.wVk = vk; i.ki.wScan = 0; i.ki.dwFlags = flags;
    return i;
  }

  static INPUT Ch(char c) {
    INPUT i = new INPUT(); i.type = 1;
    i.ki.wVk = 0; i.ki.wScan = c; i.ki.dwFlags = UNICODE;
    return i;
  }

  public static string TypeText(string s) {
    int n = 0;
    foreach (char c in s) {
      INPUT[] a = new INPUT[] { Ch(c), Ch(c) };
      a[1].ki.dwFlags = UNICODE | KEYUP;
      SendInput(2, a, Marshal.SizeOf(typeof(INPUT)));
      n++;
      System.Threading.Thread.Sleep(6);
    }
    return "typed " + n + " chars";
  }

  public static string Combo(ushort[] vks, bool[] ext) {
    int n = vks.Length;
    INPUT[] down = new INPUT[n];
    for (int k = 0; k < n; k++) down[k] = Key(vks[k], ext[k] ? EXTENDED : 0);
    SendInput((uint)n, down, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(40);
    INPUT[] up = new INPUT[n];
    for (int k = 0; k < n; k++) up[k] = Key(vks[n - 1 - k], KEYUP | (ext[n - 1 - k] ? EXTENDED : 0));
    SendInput((uint)n, up, Marshal.SizeOf(typeof(INPUT)));
    return "combo ok";
  }
}
'@

# La compilacion de C# cuesta ~500 ms por invocacion. Para trabajo seguido,
# abri una terminal persistente y dot-source este script:
#   . tools\hands.ps1 help     -> quedan Get-Windows, Assert-Foreground, etc.
Add-Type -TypeDefinition $src

[void][W]::SetProcessDPIAware()

function Get-VScreen { $v = [W]::VScreen(); return @{ X = $v[0]; Y = $v[1]; W = $v[2]; H = $v[3] } }

function Get-Candidates {
  [W]::AllWindows() | Where-Object { $_.visible -and $_.title -and $_.w -gt 120 -and $_.h -gt 50 }
}

function Get-Windows {
  $fg = [W]::GetForegroundWindow()
  Get-Candidates | Sort-Object -Property @{ Expression = 'area'; Descending = $true } | ForEach-Object {
    [pscustomobject]@{
      hwnd  = ('0x{0:X}' -f $_.hwnd.ToInt64())
      proc  = (Get-Process -Id $_.pid -ErrorAction SilentlyContinue).ProcessName
      pid   = $_.pid
      class = $_.cls
      fg    = ($_.hwnd -eq $fg)
      rect  = "$($_.x),$($_.y),$($_.w),$($_.h)"
      title = if ($_.title.Length -gt 60) { $_.title.Substring(0, 60) } else { $_.title }
    }
  } | Format-Table -AutoSize
}

function Resolve-Window([string]$needle) {
  $all = Get-Candidates
  $exact = $all | Where-Object { $_.title -eq $needle }
  if ($exact) { return ($exact | Sort-Object area -Descending | Select-Object -First 1) }
  $hits = $all | Where-Object { $_.title -like "*$needle*" } | Sort-Object area -Descending
  if (-not $hits) { throw "sin ventana para '$needle'" }
  return ($hits | Select-Object -First 1)
}

function Assert-Foreground([string]$needle) {
  # Devuelve el titulo de la ventana en primer plano; si se pasa $needle y no
  # coincide, aborta: nunca tipear a ciegas en la ventana equivocada.
  $fg = [W]::GetForegroundWindow()
  $w = [W]::AllWindows() | Where-Object { $_.hwnd -eq $fg } | Select-Object -First 1
  $t = if ($w) { $w.title } else { "" }
  if ($needle -and ($t -notlike "*$needle*")) {
    throw "foco inesperado: '$t' no contiene '$needle' - no escribo nada"
  }
  return $t
}

function Save-Shot([string]$path, $rect) {
  Add-Type -AssemblyName System.Drawing
  if (-not $path) {
    $dir = Join-Path $PSScriptRoot '..\shots'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $path = Join-Path $dir ("shot-{0}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  }
  $dirp = Split-Path $path -Parent
  if ($dirp -and -not (Test-Path $dirp)) { New-Item -ItemType Directory -Force -Path $dirp | Out-Null }
  if (-not $rect) { $rect = Get-VScreen }
  # recortar a la parte visible del escritorio virtual
  $v = Get-VScreen
  $x1 = [Math]::Max($rect.X, $v.X); $y1 = [Math]::Max($rect.Y, $v.Y)
  $x2 = [Math]::Min($rect.X + $rect.W, $v.X + $v.W)
  $y2 = [Math]::Min($rect.Y + $rect.H, $v.Y + $v.H)
  if ($x2 -le $x1 -or $y2 -le $y1) { throw "la ventana no esta visible en pantalla" }
  $rect = @{ X = $x1; Y = $y1; W = ($x2 - $x1); H = ($y2 - $y1) }
  $bmp = New-Object System.Drawing.Bitmap $rect.W, $rect.H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.X, $rect.Y, 0, 0, $bmp.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return (Resolve-Path $path).Path
}

$GAME_PROCS = @(
  'HeroesOfTheStorm_x64', 'HeroesOfTheStorm', 'Battle.net', 'steamwebhelper',
  'RiotClientServices', 'LeagueClientUx', 'VALORANT', 'VALORANT-Win64-Shipping',
  'cs2', 'GTA5', 'RocketLeague', 'Overwatch', 'Wow', 'WowClassic', 'Diablo IV',
  'Minecraft.Windows', 'EpicGamesLauncher', 'FortniteClient-Win64-Shipping'
)

function Assert-NoGame {
  # Freno de mano: si el juego esta en primer plano, no le mando input
  # (cualquier click/tecla lo minimiza). Leer con bshot si se puede.
  $fg = [W]::GetForegroundWindow()
  $w = [W]::AllWindows() | Where-Object { $_.hwnd -eq $fg } | Select-Object -First 1
  if (-not $w) { return }
  $pn = (Get-Process -Id $w.pid -ErrorAction SilentlyContinue).ProcessName
  if ($GAME_PROCS -contains $pn) {
    throw "no toco input: '$pn' esta en primer plano (me pediste no minimizarte el juego). Leer sigue disponible con bshot."
  }
}

$VK = @{
  'ctrl' = 0x11; 'control' = 0x11; 'shift' = 0x10; 'alt' = 0x12; 'win' = 0x5B;
  'enter' = 0x0D; 'return' = 0x0D; 'tab' = 0x09; 'esc' = 0x1B; 'space' = 0x20;
  'back' = 0x08; 'del' = 0x2E; 'delete' = 0x2E; 'ins' = 0x2D; 'insert' = 0x2D;
  'home' = 0x24; 'end' = 0x23; 'up' = 0x26; 'down' = 0x28; 'left' = 0x25; 'right' = 0x27;
  'pageup' = 0x21; 'pagedown' = 0x22; 'printscreen' = 0x2C; 'menu' = 0x5D;
}
$EXT = @('up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'del', 'delete', 'ins', 'insert')

function Send-Combo([string]$spec) {
  $parts = $spec.ToLower() -split '\s*\+\s*'
  $vks = @(); $exts = @()
  foreach ($p in $parts) {
    if ($VK.ContainsKey($p)) { $vks += [uint16]$VK[$p]; $exts += ($EXT -contains $p) }
    elseif ($p -match '^f([1-9]|1[0-9]|2[0-4])$') { $vks += [uint16](0x70 + [int]$Matches[1] - 1); $exts += $false }
    elseif ($p.Length -eq 1) { $vks += [uint16]([int][char]$p.ToUpper()); $exts += $false }
    else { throw "tecla desconocida: $p" }
  }
  return [W]::Combo($vks, $exts)
}

$texto = (@($A1, $A2, $A3, $A4) | Where-Object { $_ -ne $null -and $_ -ne '' }) -join ' '

switch ($Cmd.ToLower()) {
  'help' {
    @'
hands.ps1 <cmd> [args]

  windows                     ventanas visibles ordenadas por tamano
  focus <parte del titulo>    trae la ventana al frente
  shot [-Out ruta]            captura todo el escritorio virtual
  wshot <titulo> [-Out ruta]  captura solo esa ventana (zona visible)
  bshot <titulo> [-Out ruta]  captura en segundo plano, sin robar foco
  wrect <titulo>              geometria de esa ventana
  maximize <titulo>           maximiza y trae al frente
  pos                         posicion del cursor
  move <x> <y>
  click <x> <y> [-Right|-Middle] [-Double] [-Times n]
  drag <x1> <y1> <x2> <y2>
  scroll <x> <y> <notches>    negativo = hacia abajo
  type <texto>
  key <combo>                 ej: key ctrl+v / key alt+tab / key enter
  clip <texto>                pone texto en el portapapeles
  paste                       ctrl+v
  vscreen                     geometria del escritorio virtual

Freno de mano: click/type/key/drag/scroll se niegan si un juego esta en primer
plano (para no minimizarlo). Leer con bshot/wshot nunca interfiere.
Usar -Force para saltear el freno, -Guard <titulo> para exigir ventana activa.
'@
  }
  'windows' { Get-Windows }
  'vscreen' { $v = Get-VScreen; "virtual: x=$($v.X) y=$($v.Y) w=$($v.W) h=$($v.H)" }
  'focus' {
    $w = Resolve-Window $texto
    if ([W]::IsIconic($w.hwnd)) { [void][W]::ShowWindow($w.hwnd, 9) }
    [void][W]::SetForegroundWindow($w.hwnd)
    Start-Sleep -Milliseconds 300
    "focused: $($w.title) [$($w.cls)]"
  }
  'pos' { $p = New-Object W+POINT; [void][W]::GetCursorPos([ref]$p); "cursor: $($p.X),$($p.Y)" }
  'wrect' {
    $w = Resolve-Window $texto
    "$($w.title) | $($w.cls) | hwnd=0x$('{0:X}' -f $w.hwnd.ToInt64()) | x=$($w.x) y=$($w.y) w=$($w.w) h=$($w.h)"
  }
  'maximize' {
    $w = Resolve-Window $texto
    [void][W]::ShowWindow($w.hwnd, 3)
    Start-Sleep -Milliseconds 250
    [void][W]::SetForegroundWindow($w.hwnd)
    Start-Sleep -Milliseconds 200
    $r = New-Object W+RECT; [void][W]::GetWindowRect($w.hwnd, [ref]$r)
    "maximized: $($w.title) -> $($r.Left),$($r.Top) $($r.Right - $r.Left)x$($r.Bottom - $r.Top)"
  }
  'shot' { if ($A1) { $Out = $A1 }; Save-Shot $Out $null }
  'wshot' {
    $w = Resolve-Window $A1
    $rect = @{ X = $w.x; Y = $w.y; W = $w.w; H = $w.h }
    $p = Save-Shot $Out $rect
    "$p  [$($w.title) | $($w.cls) | $($w.x),$($w.y) $($w.w)x$($w.h)]"
  }
  'bshot' {
    # captura en segundo plano (PrintWindow): no necesita foco ni mover la ventana
    Add-Type -AssemblyName System.Drawing
    $w = Resolve-Window $A1
    if (-not $Out) {
      $dir = Join-Path $PSScriptRoot '..\shots'
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
      $Out = Join-Path $dir ("bg-{0}.png" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }
    $bmp = New-Object System.Drawing.Bitmap $w.w, $w.h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdc = $g.GetHdc()
    $ok = [W]::PrintWindow($w.hwnd, $hdc, 2)
    $g.ReleaseHdc($hdc)
    $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    "$((Resolve-Path $Out).Path)  ok=$ok  [$($w.title)]"
  }
  'move' { [W]::MoveTo([int]$A1, [int]$A2) }
  'fg' {
    $fg = [W]::GetForegroundWindow()
    $w = [W]::AllWindows() | Where-Object { $_.hwnd -eq $fg } | Select-Object -First 1
    if ($w) { "fg: '$($w.title)' [$($w.cls)] hwnd=0x$('{0:X}' -f $w.hwnd.ToInt64())" } else { "fg: hwnd=0x$('{0:X}' -f $fg.ToInt64()) (sin datos)" }
  }
  'click' {
    if (-not $Force) { Assert-NoGame }
    if ($A1 -match '^[-0-9]+\s*,\s*[-0-9]+$') { $xy = $A1 -split ','; $A1 = $xy[0].Trim(); $A2 = $xy[1].Trim() }
    if ($Guard) { [void](Assert-Foreground $Guard) }
    $btn = 0; if ($Right) { $btn = 1 }; if ($Middle) { $btn = 2 }
    $t = $Times; if ($Double) { $t = 2 }
    [W]::Click([int]$A1, [int]$A2, $btn, $t)
  }
  'drag' { if (-not $Force) { Assert-NoGame }; [W]::Drag([int]$A1, [int]$A2, [int]$A3, [int]$A4) }
  'scroll' { if (-not $Force) { Assert-NoGame }; [W]::Wheel([int]$A1, [int]$A2, [int]$A3) }
  'type' {
    if (-not $Force) { Assert-NoGame }
    $t = Assert-Foreground $Guard
    $r = [W]::TypeText($texto)
    "fg='$t' $r"
  }
  'key' {
    if (-not $Force) { Assert-NoGame }
    $t = Assert-Foreground $Guard
    $r = Send-Combo $texto
    "fg='$t' $r"
  }
  'clip' { Set-Clipboard -Value $texto; "clipboard set ($($texto.Length) chars)" }
  'paste' {
    if (-not $Force) { Assert-NoGame }
    $t = Assert-Foreground $Guard
    $r = Send-Combo 'ctrl+v'
    "fg='$t' $r"
  }
  default { throw "comando desconocido: $Cmd (usar 'help')" }
}

