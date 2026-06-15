import { execFile } from 'child_process';

export interface CertificadoWindows {
  cnpj: string;
  razaoSocial: string;
  uf: string;
  serial: string;
  thumbprint: string;
  vencimento: string; // ISO
  vencido: boolean;
}

interface CertBruto {
  Subject: string;
  SerialNumber: string;
  Thumbprint: string;
  NotAfter: string;
  HasPrivateKey: boolean;
}

function rodarPowerShell(comando: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', comando],
      { maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    );
  });
}

function extrairCampo(subject: string, chave: string): string {
  // Ex.: "S=CE" ou "CN=Fulano:123" dentro do Subject separado por vírgulas
  const re = new RegExp(`(?:^|,)\\s*${chave}=([^,]+)`, 'i');
  return subject.match(re)?.[1]?.trim() ?? '';
}

/**
 * Lê o repositório de certificados do usuário no Windows (Cert:\CurrentUser\My),
 * extrai os e-CNPJ (com chave privada), deduplica por CNPJ mantendo o de maior
 * validade e ignora certificados sem CNPJ (ex.: certificados de máquina/CPF).
 */
export async function listarCertificadosWindows(): Promise<CertificadoWindows[]> {
  const comando =
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
    'Get-ChildItem Cert:\\CurrentUser\\My | ' +
    "Select-Object Subject,SerialNumber,Thumbprint,@{n='NotAfter';e={$_.NotAfter.ToString('o')}},HasPrivateKey | " +
    'ConvertTo-Json -Compress';

  const saida = (await rodarPowerShell(comando)).trim();
  if (!saida) return [];

  const parsed = JSON.parse(saida) as CertBruto | CertBruto[];
  const lista = Array.isArray(parsed) ? parsed : [parsed];

  const porCnpj = new Map<string, CertificadoWindows>();

  for (const c of lista) {
    if (!c.HasPrivateKey) continue;

    const cn = extrairCampo(c.Subject, 'CN');
    if (!cn.includes(':')) continue; // e-CNPJ tem formato "RAZAO:CNPJ"

    const [razao, doc] = cn.split(':');
    const cnpj = (doc ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14) continue; // ignora e-CPF (11) e certs sem CNPJ

    const vencimento = new Date(c.NotAfter);
    const info: CertificadoWindows = {
      cnpj,
      razaoSocial: razao.trim(),
      uf: extrairCampo(c.Subject, 'S') || 'CE',
      serial: c.SerialNumber,
      thumbprint: c.Thumbprint,
      vencimento: vencimento.toISOString(),
      vencido: vencimento < new Date(),
    };

    // Mantém, por CNPJ, o certificado de maior validade
    const existente = porCnpj.get(cnpj);
    if (!existente || new Date(info.vencimento) > new Date(existente.vencimento)) {
      porCnpj.set(cnpj, info);
    }
  }

  return [...porCnpj.values()].sort((a, b) => a.cnpj.localeCompare(b.cnpj));
}
