param(
  [Parameter(Mandatory = $true)]
  [string]$PfxPath,

  [SecureString]$Password,

  [ValidatePattern('^\d{14}$')]
  [string]$Cnpj,

  [ValidatePattern('^\d{8}$')]
  [string]$RaizCnpj,

  [string]$Remote = 'root@187.127.45.197',
  [string]$SshKey = "$HOME\.ssh\newshop_vps",
  [string]$AppPath = '/home/danfe/htdocs/danfe.newgrup.cloud',
  [string]$RemoteFileName,
  [switch]$Restart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Cnpj -and $RaizCnpj) {
  throw 'Use apenas -Cnpj ou -RaizCnpj, nao os dois.'
}

$resolvedPfx = (Resolve-Path -LiteralPath $PfxPath).Path
if ([IO.Path]::GetExtension($resolvedPfx).ToLowerInvariant() -ne '.pfx') {
  throw 'O arquivo precisa ser um certificado A1 .pfx.'
}

if (-not (Test-Path -LiteralPath $SshKey)) {
  throw "Chave SSH nao encontrada: $SshKey"
}

if (-not $Password) {
  $Password = Read-Host 'Senha do certificado PFX' -AsSecureString
}

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($plainPassword)) {
  throw 'Senha vazia nao permitida.'
}

if ($plainPassword -match "[`r`n]") {
  throw 'Senha com quebra de linha nao e suportada para gravar no .env.'
}

if (-not $RemoteFileName) {
  $RemoteFileName = [IO.Path]::GetFileName($resolvedPfx)
}

$RemoteFileName = ($RemoteFileName -replace '[^A-Za-z0-9_.-]', '_')
if (-not $RemoteFileName.ToLowerInvariant().EndsWith('.pfx')) {
  $RemoteFileName += '.pfx'
}

$scope = 'default'
$scopeValue = ''
if ($Cnpj) {
  $scope = 'cnpj'
  $scopeValue = $Cnpj
} elseif ($RaizCnpj) {
  $scope = 'raiz'
  $scopeValue = $RaizCnpj
}

function To-Base64Utf8([string]$Value) {
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
}

$remoteTmp = '/tmp/danfe-cert-upload'
$remoteTarget = "$remoteTmp/$RemoteFileName"

Write-Host "Criando pasta temporaria na VPS..."
& ssh -i $SshKey $Remote "mkdir -p '$remoteTmp' && chmod 700 '$remoteTmp'"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar a VPS via SSH.' }

Write-Host "Enviando certificado para a VPS..."
& scp -i $SshKey -p $resolvedPfx "${Remote}:$remoteTarget"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao enviar o certificado via scp.' }

$appPathB64 = To-Base64Utf8 $AppPath
$certNameB64 = To-Base64Utf8 $RemoteFileName
$passwordB64 = To-Base64Utf8 $plainPassword
$scopeValueB64 = To-Base64Utf8 $scopeValue
$restartFlag = if ($Restart) { '1' } else { '0' }

$remoteScript = @"
set -euo pipefail

decode() {
  printf '%s' "`$1" | base64 -d
}

APP=`$(decode '$appPathB64')
CERT_NAME=`$(decode '$certNameB64')
PASSWORD=`$(decode '$passwordB64')
SCOPE='$scope'
SCOPE_VALUE=`$(decode '$scopeValueB64')
RESTART='$restartFlag'
TMP_CERT='$remoteTarget'
ENV_FILE="`$APP/.env"
CERT_DIR="`$APP/certs"
CERT_REL="./certs/`$CERT_NAME"
CERT_DST="`$CERT_DIR/`$CERT_NAME"

dotenv_value() {
  value="`$1"
  if printf '%s' "`$value" | grep -Eq '^[A-Za-z0-9_./:@%+-]+$'; then
    printf '%s' "`$value"
  else
    escaped=`$(printf '%s' "`$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '"%s"' "`$escaped"
  fi
}

upsert_env() {
  key="`$1"
  value="`$2"
  tmp_file=`$(mktemp)
  found=0

  touch "`$ENV_FILE"
  while IFS= read -r line || [ -n "`$line" ]; do
    case "`$line" in
      "`$key="*)
        printf '%s=%s\n' "`$key" "`$value" >> "`$tmp_file"
        found=1
        ;;
      *)
        printf '%s\n' "`$line" >> "`$tmp_file"
        ;;
    esac
  done < "`$ENV_FILE"

  if [ "`$found" -eq 0 ]; then
    printf '%s=%s\n' "`$key" "`$value" >> "`$tmp_file"
  fi

  cat "`$tmp_file" > "`$ENV_FILE"
  rm -f "`$tmp_file"
}

case "`$SCOPE" in
  cnpj)
    PATH_KEY="CERT_PFX_PATH_`$SCOPE_VALUE"
    PASS_KEY="CERT_PFX_PASSWORD_`$SCOPE_VALUE"
    ;;
  raiz)
    PATH_KEY="CERT_PFX_PATH_RAIZ_`$SCOPE_VALUE"
    PASS_KEY="CERT_PFX_PASSWORD_RAIZ_`$SCOPE_VALUE"
    ;;
  *)
    PATH_KEY='CERT_PFX_PATH'
    PASS_KEY='CERT_PFX_PASSWORD'
    ;;
esac

mkdir -p "`$CERT_DIR"
cp -f "`$TMP_CERT" "`$CERT_DST"
chmod 600 "`$CERT_DST"
rm -f "`$TMP_CERT"

upsert_env "`$PATH_KEY" "`$(dotenv_value "`$CERT_REL")"
upsert_env "`$PASS_KEY" "`$(dotenv_value "`$PASSWORD")"
chmod 600 "`$ENV_FILE"

if id danfe >/dev/null 2>&1; then
  chown danfe:danfe "`$ENV_FILE" "`$CERT_DST"
fi

if [ "`$RESTART" = '1' ]; then
  su - danfe -c 'export PATH=/home/danfe/.nvm/versions/node/v22.23.1/bin:`$PATH; pm2 restart danfecollector && pm2 save'
fi

printf 'OK certificado: %s\n' "`$CERT_DST"
printf 'OK env path: %s\n' "`$PATH_KEY"
printf 'OK env senha: %s\n' "`$PASS_KEY"
"@

Write-Host "Atualizando .env remoto..."
$remoteScript | & ssh -i $SshKey $Remote 'bash -s'
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar o .env na VPS.' }

$plainPassword = $null
Write-Host 'Concluido.'
