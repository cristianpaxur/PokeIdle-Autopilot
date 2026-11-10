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

function Find-Docker {
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  foreach ($base in @("$env:LOCALAPPDATA\Programs\DockerDesktop", "$env:ProgramFiles\Docker\Docker")) {
    $file = Join-Path $base 'resources\bin\docker.exe'
    if (Test-Path -LiteralPath $file -PathType Leaf) { return $file }
  }
}

$docker = Find-Docker
if (!$docker) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (!$winget) { throw 'O Windows precisa do Instalador de Aplicativos (WinGet) para baixar o Docker Desktop.' }
  & $winget.Source install --id Docker.DockerDesktop --exact --source winget --silent --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw 'O WinGet nao concluiu a instalacao do Docker Desktop.' }
  $docker = Find-Docker
  if (!$docker) { throw 'O Docker Desktop foi instalado. Reinicie o Windows se o instalador solicitar e execute novamente.' }
}
if ($env:IDLEBOT_PASSWORD -or $env:IDLEBOT_ORIGIN -or $env:IDLEBOT_PORT) {
  throw 'Defina as variaveis IDLEBOT_PASSWORD, IDLEBOT_ORIGIN e IDLEBOT_PORT apenas em .env.docker.'
}
$engine = & $docker info --format '{{.OSType}}' 2>$null
if ($LASTEXITCODE -ne 0) {
  & $docker desktop start --timeout 120
  $engine = & $docker info --format '{{.OSType}}' 2>$null
}
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

  & $docker compose --env-file .env.docker up -d --build --wait --wait-timeout 180
  if ($LASTEXITCODE -ne 0) { throw 'O Docker nao confirmou que o painel iniciou.' }
  Write-Output 'Entre no painel com idlebot e a senha em .env.docker.'
  Write-Output 'Preparando o QR code do celular...'
  $qr = (& $docker compose --env-file .env.docker exec -T idlebot node src/print-mobile-qr.mjs) -join "`n"
  if ($LASTEXITCODE -ne 0 -or $qr -notmatch '^<svg') {
    throw 'O painel iniciou. O acesso ao celular ainda esta conectando. Veja QR do celular no painel.'
  }
  $qrPage = Join-Path ([System.IO.Path]::GetTempPath()) 'IdleBot-QR-do-celular.html'
  $page = @'
<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IdleBot no celular</title><style>
body{background:#101713;color:#f2f7f0;font:17px system-ui;text-align:center;margin:10vh auto;padding:0 20px}
h1{margin:0;color:#b0f883}svg{max-width:100%;height:auto;background:white;border-radius:8px}
</style><h1>IdleBot no celular</h1><p>Escaneie com a c&acirc;mera para acompanhar a ca&ccedil;a e as vendas.</p>
'@
  [System.IO.File]::WriteAllText($qrPage, "$page`n$qr`n</html>")
  Start-Process -FilePath $qrPage
} finally {
  Pop-Location
}
