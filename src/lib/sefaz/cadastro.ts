import * as https from 'https';
import { XMLParser } from 'fast-xml-parser';
import { obterPemDoCertificado } from './assinatura';

const ENDPOINT_CONSULTA_CADASTRO = process.env.SEFAZ_CONSULTA_CADASTRO_URL || 'https://cad.svrs.rs.gov.br/ws/cadconsultacadastro/cadconsultacadastro4.asmx';

export type CadastroContribuinteSefaz = {
  ie: string;
  cnpj: string | null;
  uf: string;
  razaoSocial: string | null;
  nomeFantasia: string | null;
  situacao: string | null;
  cnae: string | null;
  regimeApuracao: string | null;
  dataInicioAtividade: string | null;
  dataUltimaSituacao: string | null;
  endereco: string | null;
};

export type RetornoCadastroContribuinteSefaz = {
  cStat: number;
  xMotivo: string;
  consultadoEm: string | null;
  cadastros: CadastroContribuinteSefaz[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
});

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  const limpo = String(valor).trim();
  return limpo || null;
}

function itens<T>(valor: T | T[] | undefined | null): T[] {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function montarEnvelope(uf: string, cnpj: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4">' +
    '<ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00">' +
    '<infCons>' +
    '<xServ>CONS-CAD</xServ>' +
    `<UF>${uf}</UF>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    '</infCons>' +
    '</ConsCad>' +
    '</nfeDadosMsg>' +
    '</soap12:Body>' +
    '</soap12:Envelope>'
  );
}

function requisicaoSoap(body: string): Promise<string> {
  const { privateKeyPem, certificatePem } = obterPemDoCertificado();
  const url = new URL(ENDPOINT_CONSULTA_CADASTRO);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        key: privateKeyPem,
        cert: certificatePem,
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          const textoResposta = Buffer.concat(chunks).toString('utf8');
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`SEFAZ Cadastro HTTP ${res.statusCode}: ${textoResposta.slice(0, 300)}`));
            return;
          }
          resolve(textoResposta);
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('Timeout na consulta cadastro SEFAZ (60s).')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function situacaoCadastro(cSit: string | null): string | null {
  if (cSit === '1') return 'Habilitado';
  if (cSit === '0') return 'Nao habilitado';
  return cSit;
}

function montarEndereco(ender: Record<string, unknown> | null | undefined): string | null {
  if (!ender) return null;
  return [
    texto(ender.xLgr),
    texto(ender.nro),
    texto(ender.xCpl),
    texto(ender.xBairro),
    texto(ender.xMun),
    texto(ender.UF),
    texto(ender.CEP),
  ].filter(Boolean).join(', ') || null;
}

export async function consultarCadastroContribuinteSefaz(uf: string, cnpj: string): Promise<RetornoCadastroContribuinteSefaz> {
  const ufNormalizada = uf.trim().toUpperCase();
  const cnpjLimpo = cnpj.replace(/\D/g, '');
  const respostaXml = await requisicaoSoap(montarEnvelope(ufNormalizada, cnpjLimpo));
  const json = parser.parse(respostaXml);
  const infCons =
    json?.Envelope?.Body?.nfeDadosMsg?.retConsCad?.infCons ??
    json?.Envelope?.Body?.consultaCadastro2Result?.retConsCad?.infCons ??
    json?.Envelope?.Body?.nfeResultMsg?.retConsCad?.infCons;

  if (!infCons) {
    throw new Error(`Resposta inesperada da SEFAZ Cadastro: ${respostaXml.slice(0, 300)}`);
  }

  const cadastros = itens<Record<string, unknown>>(infCons.infCad).map((cad) => ({
    ie: texto(cad.IE) ?? '',
    cnpj: texto(cad.CNPJ),
    uf: texto(cad.UF) ?? ufNormalizada,
    razaoSocial: texto(cad.xNome),
    nomeFantasia: texto(cad.xFant),
    situacao: situacaoCadastro(texto(cad.cSit)),
    cnae: texto(cad.CNAE),
    regimeApuracao: texto(cad.xRegApur),
    dataInicioAtividade: texto(cad.dIniAtiv),
    dataUltimaSituacao: texto(cad.dUltSit),
    endereco: montarEndereco(cad.ender as Record<string, unknown> | null | undefined),
  })).filter((cad) => cad.ie);

  return {
    cStat: Number(infCons.cStat ?? 0),
    xMotivo: texto(infCons.xMotivo) ?? '',
    consultadoEm: texto(infCons.dhCons),
    cadastros,
  };
}
