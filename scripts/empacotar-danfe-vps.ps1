# Gera um .tgz de codigo para a VPS sem excluir pastas internas como src/lib/anexos.
# Uso: .\scripts\empacotar-danfe-vps.ps1

param(
  [string]$Destino = (Join-Path $env:TEMP ("danfe-vps-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tgz'))
)

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stage = Join-Path $env:TEMP ("danfe-vps-stage-" + [guid]::NewGuid().ToString('N'))
$excluidosRaiz = @('node_modules', '.next', '.next-dev', '.git', 'downloads', 'anexos', 'certs', '.env', 'tsconfig.tsbuildinfo')

New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Get-ChildItem -LiteralPath $raiz -Force |
    Where-Object { $_.Name -notin $excluidosRaiz } |
    ForEach-Object {
      if ($_.Name -eq 'scripts') {
        $destinoScripts = Join-Path $stage 'scripts'
        New-Item -ItemType Directory -Path $destinoScripts | Out-Null
        Get-ChildItem -LiteralPath $_.FullName -Force |
          Where-Object { $_.Name -ne '__pycache__' } |
          ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destinoScripts -Recurse -Force }
      } else {
        Copy-Item -LiteralPath $_.FullName -Destination $stage -Recurse -Force
      }
    }

  Push-Location $stage
  try {
    & tar -czf $Destino .
    if ($LASTEXITCODE -ne 0) { throw "tar falhou com codigo $LASTEXITCODE." }
  } finally {
    Pop-Location
  }

  $entradas = & tar -tzf $Destino
  if ($LASTEXITCODE -ne 0 -or -not ($entradas -match '^\./src/lib/anexos/storage\.ts$')) {
    throw 'Pacote invalido: src/lib/anexos/storage.ts nao foi incluido.'
  }

  $arquivo = Get-Item -LiteralPath $Destino
  Write-Host "Pacote pronto: $($arquivo.FullName) ($([math]::Round($arquivo.Length / 1MB, 2)) MB)" -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
}
