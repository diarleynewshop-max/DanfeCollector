"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listarCertificadosWindows = listarCertificadosWindows;
const child_process_1 = require("child_process");
function rodarPowerShell(comando) {
    return new Promise((resolve, reject) => {
        (0, child_process_1.execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando], { maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
}
function extrairCampo(subject, chave) {
    // Ex.: "S=CE" ou "CN=Fulano:123" dentro do Subject separado por vírgulas
    const re = new RegExp(`(?:^|,)\\s*${chave}=([^,]+)`, 'i');
    return subject.match(re)?.[1]?.trim() ?? '';
}
/**
 * Lê o repositório de certificados do usuário no Windows (Cert:\CurrentUser\My),
 * extrai os e-CNPJ (com chave privada), deduplica por CNPJ mantendo o de maior
 * validade e ignora certificados sem CNPJ (ex.: certificados de máquina/CPF).
 */
async function listarCertificadosWindows() {
    const comando = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' +
        'Get-ChildItem Cert:\\CurrentUser\\My | ' +
        "Select-Object Subject,SerialNumber,Thumbprint,@{n='NotAfter';e={$_.NotAfter.ToString('o')}},HasPrivateKey | " +
        'ConvertTo-Json -Compress';
    const saida = (await rodarPowerShell(comando)).trim();
    if (!saida)
        return [];
    const parsed = JSON.parse(saida);
    const lista = Array.isArray(parsed) ? parsed : [parsed];
    const porCnpj = new Map();
    for (const c of lista) {
        if (!c.HasPrivateKey)
            continue;
        const cn = extrairCampo(c.Subject, 'CN');
        if (!cn.includes(':'))
            continue; // e-CNPJ tem formato "RAZAO:CNPJ"
        const [razao, doc] = cn.split(':');
        const cnpj = (doc ?? '').replace(/\D/g, '');
        if (cnpj.length !== 14)
            continue; // ignora e-CPF (11) e certs sem CNPJ
        const vencimento = new Date(c.NotAfter);
        const info = {
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
