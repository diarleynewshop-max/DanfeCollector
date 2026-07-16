import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { assinarInfEvento, obterPemDoCertificado } from './assinatura';

// Recepção de Eventos do Ambiente Nacional (manifestação do destinatário)
const ENDPOINT_PRODUCAO =
  'https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';
const ENDPOINT_HOMOLOGACAO =
  'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx';

const NS_WSDL = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';

// Tipos de evento de manifestação do destinatário
export const TP_EVENTO = {
  CIENCIA: '210210', // Ciência da Operação (o mais leve)
  CONFIRMACAO: '210200', // Confirmação da Operação
  DESCONHECIMENTO: '210220',
  NAO_REALIZADA: '210240',
} as const;

const DESC_EVENTO: Record<string, string> = {
  '210210': 'Ciencia da Operacao',
  '210200': 'Confirmacao da Operacao',
  '210220': 'Desconhecimento da Operacao',
  '210240': 'Operacao nao Realizada',
};

export interface RetornoManifestacao {
  ok: boolean;
  cStat: number;
  xMotivo: string;
  protocolo?: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function dhEvento(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -date.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sinal}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function montarEvento(cnpj: string, chave: string, tpEvento: string, tpAmb: number): string {
  const nSeq = '1';
  const id = `ID${tpEvento}${chave}${nSeq.padStart(2, '0')}`;
  return (
    `<evento xmlns="${NS_NFE}" versao="1.00">` +
    `<infEvento Id="${id}">` +
    `<cOrgao>91</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<chNFe>${chave}</chNFe>` +
    `<dhEvento>${dhEvento(new Date())}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeq}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00">` +
    `<descEvento>${DESC_EVENTO[tpEvento]}</descEvento>` +
    `</detEvento>` +
    `</infEvento>` +
    `</evento>`
  );
}

function postSoap(url: string, body: string, cnpj: string): Promise<string> {
  const { privateKeyPem, certificatePem } = obterPemDoCertificado(cnpj);
  const { hostname, pathname } = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        key: privateKeyPem,
        cert: certificatePem,
        minVersion: 'TLSv1.2',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`SEFAZ HTTP ${res.statusCode}: ${texto.slice(0, 300)}`));
          } else {
            resolve(texto);
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout na comunicação com a SEFAZ (60s).'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Envia uma manifestação do destinatário (por padrão, Ciência da Operação) para
 * uma NF-e. Assina o evento com o certificado A1 e envia ao Ambiente Nacional.
 *
 * Códigos de sucesso: 135 (registrado e vinculado), 136 (registrado),
 * 573 (já registrado — tratado como sucesso idempotente).
 */
export async function manifestar(
  cnpj: string,
  chave: string,
  tpEvento: string = TP_EVENTO.CIENCIA,
  homologacao = false
): Promise<RetornoManifestacao> {
  const tpAmb = homologacao ? 2 : 1;
  const endpoint = homologacao ? ENDPOINT_HOMOLOGACAO : ENDPOINT_PRODUCAO;

  const eventoAssinado = assinarInfEvento(montarEvento(cnpj, chave, tpEvento, tpAmb), cnpj);
  const envEvento = `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>1</idLote>${eventoAssinado}</envEvento>`;

  const soap =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    `<nfeDadosMsg xmlns="${NS_WSDL}">${envEvento}</nfeDadosMsg>` +
    '</soap12:Body>' +
    '</soap12:Envelope>';

  const respostaXml = await postSoap(endpoint, soap, cnpj);
  const json = parser.parse(respostaXml);

  const retEnv =
    json?.Envelope?.Body?.nfeRecepcaoEventoNFResult?.retEnvEvento ??
    json?.Envelope?.Body?.nfeResultMsg?.retEnvEvento ??
    findDeep(json, 'retEnvEvento');

  if (!retEnv) {
    throw new Error(`Resposta inesperada da SEFAZ: ${respostaXml.slice(0, 400)}`);
  }

  // O resultado do evento individual fica em retEvento.infEvento
  const ret = retEnv.retEvento?.infEvento ?? retEnv.retEvento;
  const cStat = Number(ret?.cStat ?? retEnv.cStat);
  const xMotivo = String(ret?.xMotivo ?? retEnv.xMotivo ?? '');
  const protocolo = ret?.nProt ? String(ret.nProt) : undefined;

  const ok = [135, 136, 573].includes(cStat);
  return { ok, cStat, xMotivo, protocolo };
}

// Busca recursiva por uma chave no objeto (tolera variações de namespace/estrutura)
function findDeep(obj: unknown, alvo: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === alvo) return v as Record<string, unknown>;
    const achou = findDeep(v, alvo);
    if (achou) return achou;
  }
  return null;
}
