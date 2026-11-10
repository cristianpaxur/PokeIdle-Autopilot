param([uri] $RemoteOrigin)

$ErrorActionPreference = 'Stop'
$origin = $null
if ($RemoteOrigin) {
  if (!$RemoteOrigin.IsAbsoluteUri -or $RemoteOrigin.Scheme -ne 'https' -or !$RemoteOrigin.Host `
      -or $RemoteOrigin.AbsolutePath -ne '/' -or $RemoteOrigin.UserInfo -or $RemoteOrigin.Query -or $RemoteOrigin.Fragment) {
    throw 'Use o endereco HTTPS do painel, com apenas o host e a porta opcional.'
  }
  $origin = $RemoteOrigin.GetLeftPart([System.UriPartial]::Authority)
}

if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Instale o Docker Desktop antes de executar este script.'
}
if ($env:IDLEBOT_PASSWORD -or $env:IDLEBOT_ORIGIN -or $env:IDLEBOT_PORT) {
  throw 'Defina as variaveis IDLEBOT_PASSWORD, IDLEBOT_ORIGIN e IDLEBOT_PORT apenas em .env.docker.'
}
$engine = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0 -or $engine -ne 'linux') {
  throw 'Inicie o Docker Desktop no modo Linux e execute o script novamente.'
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
  $envFile = Join-Path (Get-Location).Path '.env.docker'
  $hasFile = [System.IO.File]::Exists($envFile)
  $lines = @()
  if ($hasFile) { $lines = [System.IO.File]::ReadAllLines($envFile) }
  $needsPassword = !($lines -match '^\s*(export\s+)?IDLEBOT_PASSWORD\s*=')
  if ($needsPassword) {
    $bytes = [byte[]]::new(24)
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $lines += "IDLEBOT_PASSWORD=$secret"
  }
  if ($origin) {
    $lines = @($lines -notmatch '^\s*(export\s+)?IDLEBOT_ORIGIN\s*=') + "IDLEBOT_ORIGIN=$origin"
  }
  if ($needsPassword -or $origin) {
    $temporaryFile = "$envFile.$([System.IO.Path]::GetRandomFileName())"
    try {
      [System.IO.File]::WriteAllLines($temporaryFile, [string[]]$lines)
      if ($hasFile) { [System.IO.File]::Replace($temporaryFile, $envFile, [NullString]::Value) }
      else { [System.IO.File]::Move($temporaryFile, $envFile) }
    } finally {
      if ([System.IO.File]::Exists($temporaryFile)) { [System.IO.File]::Delete($temporaryFile) }
    }
  }

  docker compose --env-file .env.docker up -d --build --wait --wait-timeout 180
  if ($LASTEXITCODE -ne 0) { throw 'O Docker nao confirmou que o painel iniciou.' }
  if ($origin) { Write-Output "Painel HTTPS: $origin" }
  Write-Output 'Entre no painel com idlebot e a senha em .env.docker.'
} finally {
  Pop-Location
}
