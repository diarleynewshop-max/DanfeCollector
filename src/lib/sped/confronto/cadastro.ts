/**
 * Regras de confronto de CADASTRO (Bloco 0) — R-CAD-01 a R-CAD-08
 *
 * Cruza os participantes (0150) e produtos (0200) do SPED com os dados
 * do DanfeCollector (NotaFiscal, consulta IE, CNPJ.ws).
 */

import type { SpedRegistro0150, SpedRegistro0200, SpedRegistroC100, SpedFiscalParsed } from '../types';
import { limparCnpjSped } from '../parser';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface DivergenciaCadastro {
  codigoRegra: string;
  tipo: string;
  severidade: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAIXA' | 'INFO';
  registroSped: string;
  linhaSped: number;
  campo: string;
  valorSped: string;
  valorDanfe: string;
  descricao: string;
  chaveNfe?: string;
  participanteCod?: string;
  produtoCod?: string;
  fornecedorNome?: string;
  fornecedorCnpj?: string;
}

export interface NotaDanfe {
  chave: string;
  emitenteCnpj: string | null;
  emitenteNome: string | null;
  emitenteIe: string | null;
  emitenteUf: string | null;
  destCnpj: string | null;
}

export interface ConsultaIeResult {
  cnpj: string;
  inscricoesEstaduais: Array<{
    inscricao: string;
    uf: string;
    ativo: boolean;
  }>;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function normalizarTexto(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function similaridade(a: string, b: string): number {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  // Similaridade simples por inclusão
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // Contagem de palavras comuns
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  let comuns = 0;
  for (const w of Array.from(wordsA)) if (wordsB.has(w)) comuns++;
  const total = Math.max(wordsA.size, wordsB.size);
  return total > 0 ? comuns / total : 0;
}

// ─── Regras ─────────────────────────────────────────────────────────────

/**
 * Confronta os cadastros do SPED (0150, 0200) com os dados do DanfeCollector.
 *
 * @param sped - SPED parseado
 * @param notasDanfe - Notas do DanfeCollector no mesmo período (chave → dados)
 * @param consultasIe - Cache de consultas de IE já realizadas (cnpj → resultado), opcional
 */
export function confrontarCadastros(
  sped: SpedFiscalParsed,
  notasDanfe: Map<string, NotaDanfe>,
  consultasIe?: Map<string, ConsultaIeResult>,
): DivergenciaCadastro[] {
  const divergencias: DivergenciaCadastro[] = [];
  const cnpjEmpresa = limparCnpjSped(sped.abertura.cnpj);

  // Mapa de código de participante → registro 0150
  const participantesPorCodigo = new Map<string, SpedRegistro0150>();
  for (const p of sped.participantes) {
    participantesPorCodigo.set(p.codigoParticipante, p);
  }

  // Mapa de CNPJ do participante → notas onde aparece (como emitente ou destCnpj)
  const cnpjParticipantesUsados = new Set<string>();
  const notasPorEmitenteCnpj = new Map<string, NotaDanfe[]>();
  for (const nota of Array.from(notasDanfe.values())) {
    const cnpj = (nota.emitenteCnpj ?? '').replace(/\D/g, '');
    if (cnpj) {
      if (!notasPorEmitenteCnpj.has(cnpj)) notasPorEmitenteCnpj.set(cnpj, []);
      notasPorEmitenteCnpj.get(cnpj)!.push(nota);
    }
  }

  // R-CAD-02: NF no C100 referenciando participante inexistente no 0150
  for (const c100 of sped.notasFiscais) {
    if (!c100.codigoParticipante) continue;
    if (!participantesPorCodigo.has(c100.codigoParticipante)) {
      divergencias.push({
        codigoRegra: 'R-CAD-02',
        tipo: 'CADASTRO_CNPJ',
        severidade: 'CRITICA',
        registroSped: 'C100',
        linhaSped: c100.linha,
        campo: 'COD_PART',
        valorSped: c100.codigoParticipante,
        valorDanfe: '',
        descricao: `NF-e ${c100.chaveNfe || c100.numero} referencia participante "${c100.codigoParticipante}" que não existe no registro 0150. Erro de geração do ERP.`,
        chaveNfe: c100.chaveNfe,
        participanteCod: c100.codigoParticipante,
      });
    }
  }

  // Verificações para cada participante (0150)
  for (const part of sped.participantes) {
    const cnpjPart = limparCnpjSped(part.cnpj);
    if (!cnpjPart || cnpjPart === cnpjEmpresa) continue; // pular a própria empresa

    cnpjParticipantesUsados.add(cnpjPart);
    const notasDoFornecedor = notasPorEmitenteCnpj.get(cnpjPart) ?? [];

    // R-CAD-01 (participante sem NF no DanfeCollector) foi removida: repetia, por fornecedor,
    // o mesmo aviso que a R-DOC-01 já dá por nota.
    if (notasDoFornecedor.length === 0) continue;
    const primeiraNotaXml = notasDoFornecedor[0];

    // R-CAD-03: CNPJ divergente
    // (já filtrado: cnpjPart == emitenteCnpj — então divergência seria se 0150 tem um CNPJ
    // mas o C100 aponta para NF com CNPJ diferente no XML)
    // Isso é verificado nas regras de documentos (R-DOC)

    // R-CAD-04: IE divergente entre SPED e XML
    const ieSped = (part.ie ?? '').replace(/\D/g, '');
    const ieXml = (primeiraNotaXml.emitenteIe ?? '').replace(/\D/g, '');
    if (ieSped && ieXml && ieSped !== ieXml) {
      divergencias.push({
        codigoRegra: 'R-CAD-04',
        tipo: 'CADASTRO_IE',
        severidade: 'ALTA',
        registroSped: '0150',
        linhaSped: part.linha,
        campo: 'IE',
        valorSped: ieSped,
        valorDanfe: ieXml,
        descricao: `IE do participante "${part.nome}" no SPED (${ieSped}) diverge da IE no XML da NF-e (${ieXml}). Pode causar glosa de crédito de ICMS.`,
        participanteCod: part.codigoParticipante,
        fornecedorNome: part.nome,
        fornecedorCnpj: cnpjPart,
      });
    }

    // R-CAD-05: IE inativa/inexistente (se temos consulta IE disponível)
    if (ieSped && consultasIe) {
      const consultaIe = consultasIe.get(cnpjPart);
      if (consultaIe) {
        const ieEncontrada = consultaIe.inscricoesEstaduais.find(
          ie => ie.inscricao.replace(/\D/g, '') === ieSped
        );
        if (ieEncontrada && !ieEncontrada.ativo) {
          divergencias.push({
            codigoRegra: 'R-CAD-05',
            tipo: 'CADASTRO_IE',
            severidade: 'ALTA',
            registroSped: '0150',
            linhaSped: part.linha,
            campo: 'IE',
            valorSped: ieSped,
            valorDanfe: 'IE INATIVA na SEFAZ',
            descricao: `IE ${ieSped} do participante "${part.nome}" está INATIVA/BAIXADA na SEFAZ. Crédito de ICMS sobre notas deste fornecedor será glosado.`,
            participanteCod: part.codigoParticipante,
            fornecedorNome: part.nome,
            fornecedorCnpj: cnpjPart,
          });
        } else if (!ieEncontrada && consultaIe.inscricoesEstaduais.length > 0) {
          divergencias.push({
            codigoRegra: 'R-CAD-05',
            tipo: 'CADASTRO_IE',
            severidade: 'ALTA',
            registroSped: '0150',
            linhaSped: part.linha,
            campo: 'IE',
            valorSped: ieSped,
            valorDanfe: `IEs ativas: ${consultaIe.inscricoesEstaduais.filter(ie => ie.ativo).map(ie => ie.inscricao).join(', ') || 'nenhuma'}`,
            descricao: `IE ${ieSped} declarada no SPED para "${part.nome}" NÃO foi encontrada na consulta oficial. A IE pode estar errada.`,
            participanteCod: part.codigoParticipante,
            fornecedorNome: part.nome,
            fornecedorCnpj: cnpjPart,
          });
        }
      }
    }

    // R-CAD-06: UF divergente
    const ufSped = (part.codigoMunicipio ?? '').slice(0, 2); // primeiros 2 dígitos do código IBGE = UF
    const ufXml = (primeiraNotaXml.emitenteUf ?? '').trim().toUpperCase();
    // A UF do 0150 é pelo código do município IBGE, precisamos converter
    // Mas comparamos diretamente se temos o campo
    // Na prática, o SPED não tem campo UF direto no 0150, usa COD_MUN (IBGE)
    // Comparação mais segura seria via tabela IBGE → UF, mas por simplificação:
    if (ufXml && part.codigoMunicipio) {
      // Os 2 primeiros dígitos do código IBGE correspondem à UF
      const ufIbge = IBGE_UF[ufSped];
      if (ufIbge && ufIbge !== ufXml) {
        divergencias.push({
          codigoRegra: 'R-CAD-06',
          tipo: 'CADASTRO_UF',
          severidade: 'MEDIA',
          registroSped: '0150',
          linhaSped: part.linha,
          campo: 'COD_MUN (UF)',
          valorSped: ufIbge,
          valorDanfe: ufXml,
          descricao: `UF do participante "${part.nome}" no SPED (${ufIbge}, município IBGE ${part.codigoMunicipio}) diverge da UF no XML (${ufXml}).`,
          participanteCod: part.codigoParticipante,
          fornecedorNome: part.nome,
          fornecedorCnpj: cnpjPart,
        });
      }
    }

    // R-CAD-07: Nome/Razão Social divergente
    if (primeiraNotaXml.emitenteNome) {
      const sim = similaridade(part.nome, primeiraNotaXml.emitenteNome);
      if (sim < 0.4 && part.nome && primeiraNotaXml.emitenteNome) {
        divergencias.push({
          codigoRegra: 'R-CAD-07',
          tipo: 'CADASTRO_CNPJ',
          severidade: 'BAIXA',
          registroSped: '0150',
          linhaSped: part.linha,
          campo: 'NOME',
          valorSped: part.nome,
          valorDanfe: primeiraNotaXml.emitenteNome,
          descricao: `Nome do participante no SPED ("${part.nome}") muito diferente do XML ("${primeiraNotaXml.emitenteNome}"). Pode ser participante trocado.`,
          participanteCod: part.codigoParticipante,
          fornecedorNome: part.nome,
          fornecedorCnpj: cnpjPart,
        });
      }
    }
  }

  // R-CAD-08: Produto sem NCM ou NCM inválido
  for (const prod of sped.produtos) {
    const ncm = (prod.ncm ?? '').replace(/\D/g, '');
    if (!ncm) {
      divergencias.push({
        codigoRegra: 'R-CAD-08',
        tipo: 'NCM_DIVERGENTE',
        severidade: 'MEDIA',
        registroSped: '0200',
        linhaSped: prod.linha,
        campo: 'COD_NCM',
        valorSped: '(vazio)',
        valorDanfe: '',
        descricao: `Produto "${prod.descricao}" (código ${prod.codigoItem}) declarado sem NCM no registro 0200. NCM é obrigatório e impacta cálculo de IPI, ICMS-ST, PIS/COFINS.`,
        produtoCod: prod.codigoItem,
      });
    } else if (ncm.length !== 8) {
      divergencias.push({
        codigoRegra: 'R-CAD-08',
        tipo: 'NCM_DIVERGENTE',
        severidade: 'MEDIA',
        registroSped: '0200',
        linhaSped: prod.linha,
        campo: 'COD_NCM',
        valorSped: prod.ncm,
        valorDanfe: '(deve ter 8 dígitos)',
        descricao: `Produto "${prod.descricao}" (código ${prod.codigoItem}) com NCM "${prod.ncm}" inválido (${ncm.length} dígitos, esperado 8).`,
        produtoCod: prod.codigoItem,
      });
    }
  }

  return divergencias;
}

// ─── Tabela IBGE → UF ──────────────────────────────────────────────────

const IBGE_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
};
