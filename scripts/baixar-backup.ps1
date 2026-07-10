# baixar-backup.ps1 — Baixa o backup mais recente da VPS para o seu PC
# Uso: no PowerShell, a partir da pasta do projeto:
#   .\scripts\baixar-backup.ps1
# Opcional: forçar um novo backup na VPS antes de baixar:
#   .\scripts\baixar-backup.ps1 -Novo

param(
    [switch]$Novo,                                   # gera um backup fresco na VPS antes de baixar
    [string]$Destino = "$HOME\Downloads\DanfeBackups" # pasta local onde salvar
)

$ErrorActionPreference = 'Stop'
$chave   = "$HOME\.ssh\newshop_vps"
$vps     = "root@187.127.45.197"
$remoto  = "/home/danfe/backups/danfe-backup-latest.tgz"

if (-not (Test-Path $Destino)) { New-Item -ItemType Directory -Path $Destino -Force | Out-Null }

if ($Novo) {
    Write-Host "Gerando backup novo na VPS..." -ForegroundColor Cyan
    ssh -i $chave $vps "sudo -u danfe bash /home/danfe/backup-danfe.sh"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$local = Join-Path $Destino "danfe-backup-$stamp.tgz"

Write-Host "Baixando $remoto ..." -ForegroundColor Cyan
scp -i $chave "${vps}:$remoto" $local

$tam = (Get-Item $local).Length / 1MB
Write-Host ("OK -> {0} ({1:N1} MB)" -f $local, $tam) -ForegroundColor Green
