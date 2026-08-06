'use client';

import { useState, useMemo, useEffect, useTransition, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { Cnpj, NotaFiscal } from '@prisma/client';
import {
  verificarCertificado,
  enviarCertificadoVps,
  sincronizarNotas,
  sincronizarCnpjsAtivos,
  adicionarCnpj,
  alternarAtivoCnpj,
  removerCnpj,
  obterDetalheNota,
  obterNotaPorId,
  manifestarNota,
  lerCertificados,
  vincularCertificados,
  importarChavesLote,
  importarXmlsDaPasta,
  alternarEtiqueta,
  aplicarEtiquetasLote,
  manifestarNotasLote,
  listarNotasPorAno,
  listarTodasNotas,
  listarNotasRelatorio,
  previewPagamentoSitram,
  aplicarPagamentoSitram,
  anexarComprovanteLote,
  type PreviewPagamentoSitram,
  atualizarSitramPorChaves,
  consultarPagamentoIcmsNota,
  consultarPagamentoIcmsLote,
  listarChavesSitramParaAtualizacao,
  atualizarTransporteNotasExistentes,
  conferirNotasRecentes,
  listarApiKeys,
  gerarApiKey,
  revogarApiKey,
  type ActionResult,
  type ApiKeyCriada,
  type ApiKeyResumo,
  type CertificadoComStatus,
  type ResultadoImportChave,
  type ResultadoManifestoLote,
  type ResultadoPagamentoIcmsLote,
  type NotaRelatorio,
  type ResultadoSitramManifesto,
  type ResumoInicio,
  type SyncHealth,
} from '@/lib/actions';
import type { DanfeData } from '@/lib/sefaz/detalhe';
import {
  chaveDataLocal,
  diasAteVencimento,
  extrairPagamentoIcmsSitram,
  extrairResumoDae,
  lancamentosVisiveisDae,
  situacaoSitramEfetiva,
  type DaeCompartilhadoInfo,
  statusDaeEfetivo,
  type LancamentoDaeNormalizado,
} from '@/lib/sitram/dae';
import { extrairEspelhoSitram } from '@/lib/sitram/espelho';
import type { UsuarioLogado } from '@/lib/usuarios/auth';
import {
  listarUsuariosAdmin,
  sairUsuario,
  salvarUsuarioAdmin,
  type UsuarioAdminResumo,
} from '@/lib/usuarios/actions';
import {
  listarAnexos,
  enviarAnexo,
  excluirAnexo,
  type AnexoInfo,
} from '@/lib/anexos/actions';
import DanfeView from './components/DanfeViewResizable';
import ItensView from './components/ItensView';
import SitramEspelhoView from './components/SitramEspelhoView';
import SitramItensView from './components/SitramItensView';
import MapaBrasil, { nomeUf, type ValorUf } from './components/MapaBrasil';
import FornecedorIeConsulta from './components/FornecedorIeConsulta';
import { useIdioma } from '@/lib/i18n';

type NotaComCnpj = NotaFiscal & { cnpj: { cnpj: string; razaoSocial: string | null }; situacaoSefaz?: string };
type CnpjComContagem = Cnpj & { _count: { notas: number } };
type FiltroDaeSitram = 'todos' | 'consultado' | 'sem-consulta' | 'com-dae' | 'a-pagar' | 'em-aberto' | 'pago' | 'duplicidade' | 'sem-dae' | 'nao-encontrada';
type FiltroSituacaoNota = 'inconsistente' | 'efetivada' | 'denegada' | 'pendente-conferencia' | 'com-erro' | 'pendente-recepcao' | 'cancelada' | 'pendente';
type FiltroOrigemNota = 'proprio' | 'terceiro';
type FiltroManifestoNota = 'manifestada' | 'nao-manifestada' | 'pendente-processando' | 'com-erros';
type FiltroModalidadeNota = 'simplificada' | 'estorno' | 'devolucao' | 'transferencia' | 'normal' | 'ajuste-icms';
type SecaoApp = 'home' | 'notas' | 'relatorios' | 'ie-fornecedor' | 'empresas' | 'usuarios' | 'configuracao';
type ColunaRedimensionavel = 'nf' | 'emitente' | 'destinatario' | 'valores' | 'transporte' | 'sitram' | 'status';
type FiltrosNotasAplicados = {
  numero: string;
  chave: string;
  serie: string;
  cnpjId: number | 'todos';
  status: 'todos' | 'RESUMO' | 'COMPLETA';
  emitente: string;
  destinatario: string;
  valorMin: string;
  valorMax: string;
  itensMin: string;
  itensMax: string;
  etiquetas: string[];
  excluirEmitentes: string[];
  dataInicio: string;
  dataFim: string;
  dataEntradaInicio: string;
  dataEntradaFim: string;
  mes: string;
  ano: string;
  situacao: 'todas' | 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA';
  situacaoSitram: string;
  daeSitram: FiltroDaeSitram;
  daeVencInicio: string;
  daeVencFim: string;
  foraCe15SemDae: boolean;
  situacoes: FiltroSituacaoNota[];
  origens: FiltroOrigemNota[];
  manifestos: FiltroManifestoNota[];
  modalidades: FiltroModalidadeNota[];
};
type FiltrosRelatorioAplicados = {
  dataInicio: string;
  dataFim: string;
  raizesEmpresa: string[];
  tipo: string;
  situacoes: string[];
  daes: string[];
  fornecedores: string[];
  fornecedorAtivo: boolean;
  risco: string;
  busca: string;
};

// DAE "a pagar" = DAE em aberto ou ainda a gerar (imposto pendente de pagamento)
const DAE_A_PAGAR = ['EM_ABERTO', 'LIBERADA_PARA_GERAR'];
const SITUACAO_SITRAM_TRAMITA = 'A Pagar - Processo TRAMITA/SANFIT';
const TAMANHO_PAGINA_RELATORIO = 200;
const RAIZES_RELATORIO_PADRAO = ['50767035', '62803717'];
const SITUACOES_RELATORIO_OPCOES = [
  { valor: 'AUTORIZADA', label: 'Autorizada' },
  { valor: 'CANCELADA', label: 'Cancelada' },
  { valor: 'DENEGADA', label: 'Denegada' },
];
const DAE_RELATORIO_OPCOES = [
  { valor: 'pago', label: 'Pago' },
  { valor: 'pendente', label: 'Pendente' },
  { valor: 'vencido', label: 'Vencido' },
  { valor: 'vence7', label: 'Vence em 7 dias' },
  { valor: 'sem-consulta', label: 'Sem consulta' },
  { valor: 'sem-dae', label: 'Sem DAE' },
  { valor: 'consultado', label: 'Consultado' },
];
const SITUACOES_NOTA_OPCOES: Array<{ valor: FiltroSituacaoNota; label: string }> = [
  { valor: 'inconsistente', label: 'Inconsistente' },
  { valor: 'efetivada', label: 'Efetivada' },
  { valor: 'denegada', label: 'Denegada' },
  { valor: 'pendente-conferencia', label: 'Pendente de Conferencia' },
  { valor: 'com-erro', label: 'Com Erro' },
  { valor: 'pendente-recepcao', label: 'Pendente Recepcao' },
  { valor: 'cancelada', label: 'Cancelada' },
  { valor: 'pendente', label: 'Pendente' },
];
const ORIGEM_NOTA_OPCOES: Array<{ valor: FiltroOrigemNota; label: string }> = [
  { valor: 'proprio', label: 'Proprio' },
  { valor: 'terceiro', label: 'Terceiro' },
];
const MANIFESTO_NOTA_OPCOES: Array<{ valor: FiltroManifestoNota; label: string }> = [
  { valor: 'manifestada', label: 'Manifestada' },
  { valor: 'nao-manifestada', label: 'Nao Manifestada' },
  { valor: 'pendente-processando', label: 'Pendente (Processando)' },
  { valor: 'com-erros', label: 'Com Erros' },
];
const MODALIDADE_NOTA_OPCOES: Array<{ valor: FiltroModalidadeNota; label: string }> = [
  { valor: 'simplificada', label: 'Simplificada' },
  { valor: 'estorno', label: 'Estorno' },
  { valor: 'devolucao', label: 'Devolucao' },
  { valor: 'transferencia', label: 'Transferencia' },
  { valor: 'normal', label: 'Normal' },
  { valor: 'ajuste-icms', label: 'Ajuste - ICMS' },
];
const CAMPO_FILTRO_NOTAS =
  'h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-300 disabled:bg-slate-100 disabled:text-slate-500';
const LARGURAS_COLUNAS_PADRAO: Record<ColunaRedimensionavel, number> = {
  nf: 130,
  emitente: 240,
  destinatario: 260,
  valores: 170,
  transporte: 220,
  sitram: 160,
  status: 160,
};

function filtrosNotasPadrao(): FiltrosNotasAplicados {
  return {
    numero: '',
    chave: '',
    serie: '',
    cnpjId: 'todos',
    status: 'todos',
    emitente: '',
    destinatario: '',
    valorMin: '',
    valorMax: '',
    itensMin: '',
    itensMax: '',
    etiquetas: [],
    excluirEmitentes: [],
    dataInicio: '',
    dataFim: '',
    dataEntradaInicio: '',
    dataEntradaFim: '',
    mes: '',
    ano: '',
    situacao: 'todas',
    situacaoSitram: '',
    daeSitram: 'todos',
    daeVencInicio: '',
    daeVencFim: '',
    foraCe15SemDae: false,
    situacoes: [],
    origens: [],
    manifestos: [],
    modalidades: [],
  };
}

interface DashboardProps {
  usuario: UsuarioLogado;
  cnpjs: CnpjComContagem[];
  notas: NotaComCnpj[];
  notasAlerta: NotaComCnpj[];
  anosDisponiveis: number[];
  totalNotas: number;
  paginaAtual: number;
  porPagina: number;
  resumoInicio: ResumoInicio;
  saudeSincronizacao: SyncHealth;
  apiKeys: ApiKeyResumo[];
}

const CACHE_DANFE_PREFIX = 'danfe-cache:v2:';
const CACHE_DANFE_INDEX = 'danfe-cache:v2:index';
const CACHE_DANFE_MAX = 12;
const cacheDanfeMemoria = new Map<number, DanfeData>();

function formatarCnpj(cnpj: string | null): string {
  if (!cnpj) return '—';
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
function moeda(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function data(d: Date | string): string {
  return new Date(d).toLocaleDateString('pt-BR');
}

function dataHora(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const valor = new Date(d);
  if (Number.isNaN(valor.getTime())) return String(d);
  return valor.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function raizCnpj(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '').slice(0, 8);
}

function nomeEmpresaRelatorioPorRaiz(raiz: string, fallback?: string | null): string {
  if (raiz === '45998339') return 'Newshop';
  if (raiz === '50767035') return 'Facil';
  if (raiz === '62803717') return 'Soye';
  return fallback || raiz || 'Empresa';
}

const LARGURA_MIN_COLUNA: Record<ColunaRedimensionavel, number> = {
  nf: 90,
  emitente: 140,
  destinatario: 160,
  valores: 130,
  transporte: 160,
  sitram: 130,
  status: 130,
};

function nomeGrupoEmpresa(cnpj: string | null | undefined): string {
  const raiz = (cnpj ?? '').replace(/\D/g, '').slice(0, 8);
  if (raiz === '50767035' || raiz === '62803717') return 'GRUPO SF';
  if (raiz === '45998339') return 'GRUPO NEWSHOP';
  return 'OUTROS';
}

function nomeEmpresaCurta(nota: NotaComCnpj): string {
  const cnpj = nota.cnpj.cnpj.replace(/\D/g, '');
  if (cnpj === '50767035000129') return 'Facil';
  if (cnpj === '50767035000200') return 'Facil Filial';
  if (cnpj === '62803717000129') return 'Soye';
  if (cnpj.startsWith('45998339')) return nota.cnpj.razaoSocial || 'Newshop';
  return nota.cnpj.razaoSocial || formatarCnpj(nota.cnpj.cnpj);
}

function numeroNotaDaChave(chave: string | null | undefined): string | null {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  const numero = normalizada.slice(25, 34);
  return numero.replace(/^0+/, '') || numero;
}

function serieNotaDaChave(chave: string | null | undefined): string | null {
  const normalizada = String(chave ?? '').replace(/\D/g, '');
  if (normalizada.length !== 44) return null;
  const serie = normalizada.slice(22, 25);
  return serie.replace(/^0+/, '') || serie;
}

function numeroNotaSistema(nota: Pick<NotaComCnpj, 'numero' | 'chave'>): string {
  return nota.numero || numeroNotaDaChave(nota.chave) || '';
}

function serieNotaSistema(nota: Pick<NotaComCnpj, 'serie' | 'chave'>): string {
  return nota.serie || serieNotaDaChave(nota.chave) || '';
}

function numeroNotaBusca(nota: Pick<NotaComCnpj, 'numero' | 'chave'>): string {
  const numero = numeroNotaSistema(nota);
  return String(Number(numero) || numero.replace(/^0+/, '') || '');
}

function lerDanfeCacheLocal(notaId: number): DanfeData | null {
  const memoria = cacheDanfeMemoria.get(notaId);
  if (memoria) return memoria;
  if (typeof window === 'undefined') return null;

  try {
    const bruto = window.localStorage.getItem(`${CACHE_DANFE_PREFIX}${notaId}`);
    if (!bruto) return null;
    const danfe = JSON.parse(bruto) as DanfeData;
    cacheDanfeMemoria.set(notaId, danfe);
    return danfe;
  } catch {
    return null;
  }
}

function salvarDanfeCacheLocal(notaId: number, danfe: DanfeData) {
  cacheDanfeMemoria.set(notaId, danfe);
  if (typeof window === 'undefined') return;

  try {
    const chave = `${CACHE_DANFE_PREFIX}${notaId}`;
    const indexAtual = JSON.parse(window.localStorage.getItem(CACHE_DANFE_INDEX) ?? '[]') as number[];
    const novoIndex = [notaId, ...indexAtual.filter((id) => id !== notaId)].slice(0, CACHE_DANFE_MAX);

    window.localStorage.setItem(chave, JSON.stringify(danfe));
    for (const antigoId of indexAtual) {
      if (!novoIndex.includes(antigoId)) {
        window.localStorage.removeItem(`${CACHE_DANFE_PREFIX}${antigoId}`);
      }
    }
    window.localStorage.setItem(CACHE_DANFE_INDEX, JSON.stringify(novoIndex));
  } catch {
    // Cache local eh opcional.
  }
}

// Etiquetas prontas para marcar com um clique, sem precisar digitar
const ETIQUETAS_PRESET = ['Conferido', 'Pendente', 'Separado', 'Revisar', 'Divergência', 'Pago', 'Devolvido', 'Urgente'];

// Uma nota pode ter várias etiquetas, guardadas separadas por vírgula
function parseEtiquetas(s: string | null | undefined): string[] {
  return (s ?? '').split(',').map((t) => t.trim()).filter(Boolean);
}

function textoSelagemSitram(nota: NotaComCnpj): string {
  if (!nota.sitramConsultadaEm) return '—';
  if (nota.sitramSelada === true) return 'Selada';
  if (nota.sitramSelada === false) return 'Pendente';
  return 'Consultada';
}

function toneSelagemSitram(nota: NotaComCnpj): 'green' | 'orange' | 'gray' {
  if (nota.sitramSelada === true) return 'green';
  if (nota.sitramSelada === false) return 'orange';
  return 'gray';
}

function textoDaeSitram(status: string | null | undefined): string {
  const labels: Record<string, string> = {
    PAGO: 'Pago',
    EM_ABERTO: 'Em aberto',
    SEM_DAE: 'Sem DAE',
    LIBERADA_PARA_GERAR: 'Gerar DAE',
    NAO_ENCONTRADA: 'Não encontrada',
    CONSULTADO: 'Consultado',
  };
  return status ? labels[status] ?? status : '—';
}

function toneDaeSitram(status: string | null | undefined): 'green' | 'orange' | 'gray' | 'amber' | 'blue' {
  if (status === 'PAGO') return 'green';
  if (status === 'EM_ABERTO') return 'orange';
  if (status === 'LIBERADA_PARA_GERAR') return 'amber';
  if (status === 'CONSULTADO') return 'blue';
  return 'gray';
}

function notaForaCeMais15DiasSemDaeOuPagamento(nota: NotaComCnpj, referencia = new Date()): boolean {
  const ufEmitente = (nota.emitenteUf ?? '').trim().toUpperCase();
  if (!ufEmitente || ufEmitente === 'CE') return false;
  if (nota.status !== 'COMPLETA') return false;
  if (nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA') return false;

  const limite = new Date(referencia);
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - 15);
  if (new Date(nota.emitidaEm).getTime() >= limite.getTime()) return false;

  const statusDae = statusDaeEfetivo(nota);
  return statusDae !== 'PAGO' && statusDae !== 'EM_ABERTO';
}

const DIAS_RECONSULTA_DAE_NOVO = 30;

function dentroJanelaReconsultaDaeNovo(
  emitidaEm: Date | string,
  lancamentos: Array<Pick<LancamentoDaeNormalizado, 'vencimento'>>
): boolean {
  const corte = new Date();
  corte.setHours(0, 0, 0, 0);
  corte.setDate(corte.getDate() - DIAS_RECONSULTA_DAE_NOVO);

  const datas = lancamentos
    .map((lancamento) => lancamento.vencimento ? new Date(lancamento.vencimento) : null)
    .filter((data): data is Date => !!data && !Number.isNaN(data.getTime()));

  const referencia = datas.length > 0
    ? new Date(Math.max(...datas.map((data) => data.getTime())))
    : new Date(emitidaEm);

  return !Number.isNaN(referencia.getTime()) && referencia.getTime() >= corte.getTime();
}

function notaElegivelConsultaPagamentoIcms(nota: NotaComCnpj): boolean {
  if (nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA') return false;
  const lancamentos = lancamentosVisiveisDae(extrairResumoDae(nota).lancamentos);
  if (lancamentos.length === 0) return false;

  const pagamento = extrairPagamentoIcmsSitram(nota);
  const daePago = statusDaeEfetivo(nota) === 'PAGO' || lancamentos.every((lancamento) => lancamento.pago);
  if (daePago && pagamento.consultadoEm && !dentroJanelaReconsultaDaeNovo(nota.emitidaEm, lancamentos)) return false;

  return true;
}

function textoFiltroSemAcento(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function modalidadesDaNota(nota: NotaComCnpj): FiltroModalidadeNota[] {
  const texto = textoFiltroSemAcento(`${nota.naturezaOp ?? ''} ${nota.modalidadeFrete ?? ''}`);
  const modalidades: FiltroModalidadeNota[] = [];

  if (texto.includes('simplif')) modalidades.push('simplificada');
  if (texto.includes('estorno')) modalidades.push('estorno');
  if (texto.includes('devol')) modalidades.push('devolucao');
  if (texto.includes('transfer')) modalidades.push('transferencia');
  if (texto.includes('ajuste') && texto.includes('icms')) modalidades.push('ajuste-icms');
  if (modalidades.length === 0) modalidades.push('normal');

  return modalidades;
}

function notaDentroPrazoManifestacao(nota: NotaComCnpj, referencia = new Date()): boolean {
  const limite = new Date(referencia);
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - 10);
  return new Date(nota.emitidaEm).getTime() >= limite.getTime();
}

export default function Dashboard({
  usuario,
  cnpjs,
  notas: notasIniciais,
  notasAlerta: notasAlertaIniciais,
  anosDisponiveis,
  totalNotas,
  paginaAtual,
  porPagina,
  resumoInicio,
  saudeSincronizacao,
  apiKeys: apiKeysIniciais,
}: DashboardProps) {
  const router = useRouter();
  const { idioma, setIdioma, t } = useIdioma();
  const podeAdministrar = usuario.admin;
  const [secaoAtual, setSecaoAtual] = useState<SecaoApp>('home');
  const [status, setStatus] = useState<{ success?: boolean; message: string }>({
    message: 'Pronto.',
  });
  // Notas em memória — podem ser substituídas por um ano específico carregado do servidor
  const [notas, setNotas] = useState<NotaComCnpj[]>(notasIniciais);
  const [notasAlerta, setNotasAlerta] = useState<NotaComCnpj[]>(notasAlertaIniciais);
  const [notasRelatorio, setNotasRelatorio] = useState<NotaRelatorio[]>([]);
  const [paginaRelatorio, setPaginaRelatorio] = useState(0);
  const [totalRelatorio, setTotalRelatorio] = useState(0);
  const [temMaisRelatorio, setTemMaisRelatorio] = useState(true);
  const [carregandoRelatorio, setCarregandoRelatorio] = useState(false);
  const [anoCarregado, setAnoCarregado] = useState<number | null>(null);
  const [carregandoAno, setCarregandoAno] = useState(false);

  // Fica `true` assim que o usuário aplica um filtro/busca ou carrega a base
  // inteira no cliente. A partir daí, o efeito abaixo nunca mais pode
  // substituir `notas` por inteiro — só mesclar — senão qualquer ação que
  // chame revalidatePath('/') no servidor (anexar arquivo, consultar
  // pagamento de ICMS etc.) faz a página trazer de volta só a 1ª página
  // padrão e a lista filtrada "some" na tela do usuário.
  const notasEstendidasRef = useRef(false);

  // Quando o servidor re-renderiza (ex: após anexar arquivo, consultar pagamento,
  // sync etc. chamando revalidatePath), o Next.js manda de novo `notasIniciais`
  // — que é só a primeira página do servidor. Se já tínhamos carregado mais
  // notas no cliente (busca com filtro, "carregar todas"), sobrescrever o
  // array inteiro faz a lista sumir/"recarregar" para o usuário. Em vez disso,
  // mesclamos: atualiza os dados das notas que vieram do servidor e mantém as
  // demais que já estavam carregadas.
  useEffect(() => {
    if (anoCarregado !== null) return;
    setNotas((atuais) => {
      if (!notasEstendidasRef.current) return notasIniciais;
      const porId = new Map(notasIniciais.map((n) => [n.id, n]));
      return atuais.map((n) => porId.get(n.id) ?? n);
    });
  }, [notasIniciais, anoCarregado]);
  useEffect(() => {
    if (anoCarregado !== null) return;
    setNotasAlerta((atuais) => {
      if (!notasEstendidasRef.current) return notasAlertaIniciais;
      const porId = new Map(notasAlertaIniciais.map((n) => [n.id, n]));
      return atuais.map((n) => porId.get(n.id) ?? n);
    });
  }, [notasAlertaIniciais, anoCarregado]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [pending, startTransition] = useTransition();

  const [certs, setCerts] = useState<CertificadoComStatus[] | null>(null);
  const [carregandoCerts, setCarregandoCerts] = useState(false);
  const [mostrarUploadCert, setMostrarUploadCert] = useState(false);
  const [mostrarAdmin, setMostrarAdmin] = useState(false);
  const [mostrarUsuarios, setMostrarUsuarios] = useState(false);
  const [usuariosAdmin, setUsuariosAdmin] = useState<UsuarioAdminResumo[] | null>(null);
  const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioAdminResumo | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyResumo[]>(apiKeysIniciais);
  const [apiTokenGerado, setApiTokenGerado] = useState<string | null>(null);
  const [apiOrigem, setApiOrigem] = useState('');

  // Importação por chave
  const [mostrarImport, setMostrarImport] = useState(false);
  const [importTexto, setImportTexto] = useState('');
  const [importCnpjId, setImportCnpjId] = useState<number | ''>('');
  const [importManifestar, setImportManifestar] = useState(true);
  const [importProgresso, setImportProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [importResumo, setImportResumo] = useState<Record<string, number> | null>(null);
  const [pastaXml, setPastaXml] = useState('');
  const [conferindoChaves, setConferindoChaves] = useState(false);

  useEffect(() => {
    setApiOrigem(window.location.origin);
  }, []);

  // Consulta SITRAM por NF-e ou MDF-e
  const [mostrarSitram, setMostrarSitram] = useState(false);
  const [sitramTexto, setSitramTexto] = useState('');
  const [sitramResultados, setSitramResultados] = useState<ResultadoSitramManifesto[] | null>(null);
  const [sitramAno, setSitramAno] = useState(String(anosDisponiveis[0] ?? new Date().getFullYear()));
  const [sitramConsultandoTudo, setSitramConsultandoTudo] = useState(false);
  const [rotinaMatinalRodando, setRotinaMatinalRodando] = useState(false);
  const [sitramProgresso, setSitramProgresso] = useState<{
    feito: number;
    total: number;
    atualizadas: number;
    erros: number;
  } | null>(null);

  function handleImportarPasta() {
    startTransition(async () => {
      const res = await importarXmlsDaPasta(pastaXml);
      setStatus(res);
      if (res.success) router.refresh();
    });
  }

  async function handleImportar() {
    const chaves = [...new Set(importTexto.match(/\d{44}/g) ?? [])];
    if (chaves.length === 0) {
      setStatus({ success: false, message: 'Nenhuma chave de 44 dígitos encontrada no texto colado.' });
      return;
    }
    if (!importCnpjId) {
      setStatus({ success: false, message: 'Selecione a empresa (destinatária) das notas.' });
      return;
    }

    setImportResumo(null);
    setImportProgresso({ feito: 0, total: chaves.length });
    const tally: Record<string, number> = {};
    const LOTE = 8;

    for (let i = 0; i < chaves.length; i += LOTE) {
      const grupo = chaves.slice(i, i + LOTE);
      let res: ResultadoImportChave[];
      try {
        res = await importarChavesLote(Number(importCnpjId), grupo, importManifestar);
      } catch {
        res = grupo.map((chave) => ({ chave, status: 'erro' as const }));
      }
      for (const r of res) tally[r.status] = (tally[r.status] ?? 0) + 1;
      setImportProgresso({ feito: Math.min(i + LOTE, chaves.length), total: chaves.length });
      setImportResumo({ ...tally });
    }

    router.refresh();
    setStatus({ success: true, message: `Importação concluída: ${chaves.length} chave(s) processada(s).` });
  }

  function handleSitram() {
    const chaves = [...new Set(sitramTexto.match(/\d{44}/g) ?? [])];
    if (chaves.length === 0) {
      setStatus({ success: false, message: 'Cole ao menos uma chave de NF-e ou MDF-e com 44 digitos.' });
      return;
    }

    setSitramResultados(null);
    startTransition(async () => {
      const res = await atualizarSitramPorChaves(chaves);
      setStatus(res);
      setSitramResultados(res.resultados);
      if (res.success) router.refresh();
    });
  }

  async function handleSitramAtualizacaoDiaria() {
    const ano = Number(sitramAno);
    setSitramResultados(null);
    setSitramProgresso(null);
    setSitramConsultandoTudo(true);

    try {
      const pendentes = await listarChavesSitramParaAtualizacao(
        ano,
        filtroCnpjId === 'todos' ? undefined : filtroCnpjId
      );
      if (!pendentes.success || pendentes.chaves.length === 0) {
        setStatus(pendentes);
        setSitramResultados([]);
        return;
      }

      const exibidos: ResultadoSitramManifesto[] = [];
      let atualizadas = 0;
      let erros = 0;
      const tamanhoLote = 5;
      setSitramProgresso({ feito: 0, total: pendentes.chaves.length, atualizadas: 0, erros: 0 });

      for (let indice = 0; indice < pendentes.chaves.length; indice += tamanhoLote) {
        const grupo = pendentes.chaves.slice(indice, indice + tamanhoLote);
        let resultadosGrupo: ResultadoSitramManifesto[];
        try {
          // O dashboard só é recarregado uma vez no final, não a cada lote.
          const resposta = await atualizarSitramPorChaves(grupo, false);
          const porChave = new Map(resposta.resultados.map((resultado) => [resultado.chave, resultado]));
          resultadosGrupo = grupo.map((chave) => porChave.get(chave) ?? ({
              chave,
              status: 'erro',
              notasNoManifesto: 0,
              notasAtualizadas: 0,
              notasNaoEncontradas: 0,
              detalhe: resposta.message || 'SITRAM não retornou resultado.',
            }));
        } catch (error: unknown) {
          resultadosGrupo = grupo.map((chave) => ({
            chave,
            status: 'erro',
            notasNoManifesto: 0,
            notasAtualizadas: 0,
            notasNaoEncontradas: 0,
            detalhe: (error as Error).message || 'Erro ao consultar SITRAM.',
          }));
        }

        for (const resultado of resultadosGrupo) {
          atualizadas += resultado.notasAtualizadas;
          if (resultado.status === 'erro') erros++;
          exibidos.push(resultado);
        }
        while (exibidos.length > 100) exibidos.shift();

        setSitramResultados([...exibidos]);
        setSitramProgresso({
          feito: Math.min(indice + grupo.length, pendentes.chaves.length),
          total: pendentes.chaves.length,
          atualizadas,
          erros,
        });

        // Pequena pausa entre lotes evita martelar o SITRAM e mantém o Node responsivo.
        if (indice + tamanhoLote < pendentes.chaves.length) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      setStatus({
        success: erros === 0,
        message: `SITRAM ${ano}: ${pendentes.chaves.length} NF-e atualizada(s), ${atualizadas} registro(s), ${erros} erro(s).`,
      });
      router.refresh();
    } finally {
      setSitramConsultandoTudo(false);
    }
  }

  async function handleRotinaMatinal(auto = false) {
    if (rotinaMatinalRodando || sitramConsultandoTudo || pending) return;

    setRotinaMatinalRodando(true);
    try {
      const nf = await sincronizarCnpjsAtivos();
      setStatus(nf);
      await handleSitramAtualizacaoDiaria();
      if (auto && typeof window !== 'undefined') {
        window.localStorage.setItem(`danfe-rotina-matinal:${new Date().toISOString().slice(0, 10)}`, 'ok');
      }
    } catch (error: unknown) {
      if (auto && typeof window !== 'undefined') {
        window.localStorage.removeItem(`danfe-rotina-matinal:${new Date().toISOString().slice(0, 10)}`);
      }
      setStatus({ success: false, message: (error as Error).message || 'Erro na rotina matinal.' });
    } finally {
      setRotinaMatinalRodando(false);
    }
  }

  function handleAtualizarTransporte() {
    startTransition(async () => {
      const res = await atualizarTransporteNotasExistentes();
      setStatus(res);
      if (res.success) router.refresh();
    });
  }

  const [filtroCnpjId, setFiltroCnpjId] = useState<number | 'todos'>('todos');
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'RESUMO' | 'COMPLETA'>('todos');
  const [expandida, setExpandida] = useState<number | null>(null);

  // Painel de importação da relação de pagamento SITRAM
  const [mostrarPagamento, setMostrarPagamento] = useState(false);

  // Busca rápida por número da NF (ou chave)
  const [filtroNumero, setFiltroNumero] = useState('');
  const [filtroChave, setFiltroChave] = useState('');
  const [filtroSerie, setFiltroSerie] = useState('');
  const [largurasColunas, setLargurasColunas] = useState<Record<ColunaRedimensionavel, number>>(LARGURAS_COLUNAS_PADRAO);
  const resizeColunaRef = useRef<{ coluna: ColunaRedimensionavel; inicioX: number; larguraInicial: number } | null>(null);
  const [todasCarregadas, setTodasCarregadas] = useState(() => notasIniciais.length >= totalNotas);
  const [carregandoTodas, setCarregandoTodas] = useState(false);

  // Filtros avançados
  const [mostrarFiltros, setMostrarFiltros] = useState(true);
  const [modoFiltroNotas, setModoFiltroNotas] = useState<'resumido' | 'avancado'>('resumido');
  const [filtroEmitente, setFiltroEmitente] = useState('');
  const [filtroDestinatario, setFiltroDestinatario] = useState('');
  const [filtroValorMin, setFiltroValorMin] = useState('');
  const [filtroValorMax, setFiltroValorMax] = useState('');
  const [filtroItensMin, setFiltroItensMin] = useState('');
  const [filtroItensMax, setFiltroItensMax] = useState('');
  const [filtroEtiquetas, setFiltroEtiquetas] = useState<string[]>([]);
  const [filtroExcluirEmitentes, setFiltroExcluirEmitentes] = useState<string[]>([]);
  const [excluirEmitenteInput, setExcluirEmitenteInput] = useState('');
  // Filtros por data
  const [filtroDataInicio, setFiltroDataInicio] = useState('');
  const [filtroDataFim, setFiltroDataFim] = useState('');
  const [filtroDataEntradaInicio, setFiltroDataEntradaInicio] = useState('');
  const [filtroDataEntradaFim, setFiltroDataEntradaFim] = useState('');
  const [filtroMes, setFiltroMes] = useState('');
  const [filtroAno, setFiltroAnoState] = useState('');

  // Quando o usuário seleciona um ano, carrega as notas daquele ano do servidor
  async function setFiltroAno(ano: string) {
    setFiltroAnoState(ano);
    if (!ano) {
      setNotas(notasIniciais);
      setNotasAlerta(notasAlertaIniciais);
      setAnoCarregado(null);
      return;
    }
    const anoNum = Number(ano);
    if (anoCarregado === anoNum) return; // já carregado
    setCarregandoAno(true);
    const resultado = await listarNotasPorAno(anoNum);
    setNotas(resultado as NotaComCnpj[]);
    setNotasAlerta(resultado as NotaComCnpj[]);
    setAnoCarregado(anoNum);
    setCarregandoAno(false);
  }
  // Filtro por situação SEFAZ (CANCELADA / DENEGADA)
  const [filtroSituacao, setFiltroSituacao] = useState<'todas' | 'AUTORIZADA' | 'CANCELADA' | 'DENEGADA'>('todas');
  const [filtroSituacaoSitram, setFiltroSituacaoSitram] = useState('');
  const [filtroDaeSitram, setFiltroDaeSitram] = useState<FiltroDaeSitram>('todos');
  const [filtroDaeVencInicio, setFiltroDaeVencInicio] = useState('');
  const [filtroDaeVencFim, setFiltroDaeVencFim] = useState('');
  const [filtroForaCe15SemDae, setFiltroForaCe15SemDae] = useState(false);
  const [filtroSituacoes, setFiltroSituacoes] = useState<FiltroSituacaoNota[]>([]);
  const [filtroOrigens, setFiltroOrigens] = useState<FiltroOrigemNota[]>([]);
  const [filtroManifestos, setFiltroManifestos] = useState<FiltroManifestoNota[]>([]);
  const [filtroModalidades, setFiltroModalidades] = useState<FiltroModalidadeNota[]>([]);
  const [filtrosAplicadosNotas, setFiltrosAplicadosNotas] = useState<FiltrosNotasAplicados>(() => filtrosNotasPadrao());

  const daePorNota = useMemo(
    () => new Map(notas.map((nota) => [nota.id, extrairResumoDae(nota)])),
    [notas]
  );

  const qtdForaCe15SemDae = useMemo(
    () => notas.filter((nota) => notaForaCeMais15DiasSemDaeOuPagamento(nota)).length,
    [notas]
  );

  const situacoesSitramParaFiltro = useMemo(() => {
    const situacoes = new Set<string>([SITUACAO_SITRAM_TRAMITA]);
    for (const nota of notas) {
      const situacao = situacaoSitramEfetiva(nota)?.trim();
      if (situacao) situacoes.add(situacao);
    }
    return [...situacoes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [notas]);

  const alertasCertificado = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    return cnpjs
      .filter((cnpj) => cnpj.ativo && cnpj.certVencimento)
      .map((cnpj) => {
        const vencimento = new Date(cnpj.certVencimento as Date);
        vencimento.setHours(0, 0, 0, 0);
        const dias = Math.ceil((vencimento.getTime() - hoje.getTime()) / 86400000);
        return { cnpj, dias, vencimento };
      })
      .filter((item) => item.dias <= 30)
      .sort((a, b) => a.dias - b.dias);
  }, [cnpjs]);

  function alternarFiltroForaCe15SemDae() {
    if (filtroForaCe15SemDae) {
      setFiltroForaCe15SemDae(false);
      return;
    }

    setFiltroDaeSitram('todos');
    setFiltroForaCe15SemDae(true);
  }

  // Sugestões de emitente/destinatário ("Nome — CNPJ") já vistas nas notas, para autocompletar
  const sugestoesEmitente = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notas) {
      const nome = n.emitenteNome ?? '';
      const cnpj = n.emitenteCnpj ?? '';
      if (!nome && !cnpj) continue;
      map.set(cnpj || nome, cnpj ? `${nome} — ${formatarCnpj(cnpj)}` : nome);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [notas]);

  const sugestoesDestinatario = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notas) {
      const nome = n.destNome ?? '';
      const cnpj = n.destCnpj ?? '';
      if (!nome && !cnpj) continue;
      map.set(cnpj || nome, cnpj ? `${nome} — ${formatarCnpj(cnpj)}` : nome);
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [notas]);

  // Etiquetas prontas + as já usadas nas notas, para marcar com um clique
  const etiquetasParaFiltro = useMemo(() => {
    const set = new Set<string>(ETIQUETAS_PRESET);
    for (const n of notas) for (const tag of parseEtiquetas(n.etiqueta)) set.add(tag);
    return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [notas]);

  function toggleFiltroEtiqueta(tag: string) {
    setFiltroEtiquetas((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleConferirNotasRecentes() {
    if (conferindoChaves || pending) return;
    setConferindoChaves(true);
    try {
      const resultado = await conferirNotasRecentes(2, 20);
      setStatus({ success: resultado.success, message: resultado.message });
      router.refresh();
    } finally {
      setConferindoChaves(false);
    }
  }

  function toggleFiltroSituacaoNota(valor: string) {
    setFiltroSituacoes((atuais) => alternarValorFiltro(atuais, valor) as FiltroSituacaoNota[]);
  }

  function toggleFiltroOrigemNota(valor: string) {
    setFiltroOrigens((atuais) => alternarValorFiltro(atuais, valor) as FiltroOrigemNota[]);
  }

  function toggleFiltroManifestoNota(valor: string) {
    setFiltroManifestos((atuais) => alternarValorFiltro(atuais, valor) as FiltroManifestoNota[]);
  }

  function toggleFiltroModalidadeNota(valor: string) {
    setFiltroModalidades((atuais) => alternarValorFiltro(atuais, valor) as FiltroModalidadeNota[]);
  }

  function adicionarExclusaoEmitente() {
    const valor = excluirEmitenteInput.trim();
    if (!valor) return;
    setFiltroExcluirEmitentes((prev) => (prev.includes(valor) ? prev : [...prev, valor]));
    setExcluirEmitenteInput('');
  }

  function removerExclusaoEmitente(valor: string) {
    setFiltroExcluirEmitentes((prev) => prev.filter((v) => v !== valor));
  }

  const filtrosAtivos = [
    filtroNumero,
    filtroChave,
    filtroSerie,
    filtroEmitente,
    filtroDestinatario,
    filtroValorMin,
    filtroValorMax,
    filtroItensMin,
    filtroItensMax,
    filtroDataInicio,
    filtroDataFim,
    filtroDataEntradaInicio,
    filtroDataEntradaFim,
    filtroMes,
    filtroAno,
    filtroCnpjId !== 'todos' ? '1' : '',
    filtroStatus !== 'todos' ? '1' : '',
    filtroSituacao !== 'todas' ? '1' : '',
    filtroSituacaoSitram,
    filtroDaeSitram !== 'todos' ? '1' : '',
    filtroDaeVencInicio,
    filtroDaeVencFim,
    filtroForaCe15SemDae ? '1' : '',
    filtroSituacoes.length > 0 ? '1' : '',
    filtroOrigens.length > 0 ? '1' : '',
    filtroManifestos.length > 0 ? '1' : '',
    filtroModalidades.length > 0 ? '1' : '',
    filtroEtiquetas.length > 0 ? '1' : '',
    filtroExcluirEmitentes.length > 0 ? '1' : '',
  ].filter(Boolean).length;

  const filtrosAplicadosAtivos = [
    filtrosAplicadosNotas.numero,
    filtrosAplicadosNotas.chave,
    filtrosAplicadosNotas.serie,
    filtrosAplicadosNotas.emitente,
    filtrosAplicadosNotas.destinatario,
    filtrosAplicadosNotas.valorMin,
    filtrosAplicadosNotas.valorMax,
    filtrosAplicadosNotas.itensMin,
    filtrosAplicadosNotas.itensMax,
    filtrosAplicadosNotas.dataInicio,
    filtrosAplicadosNotas.dataFim,
    filtrosAplicadosNotas.dataEntradaInicio,
    filtrosAplicadosNotas.dataEntradaFim,
    filtrosAplicadosNotas.mes,
    filtrosAplicadosNotas.ano,
    filtrosAplicadosNotas.situacao !== 'todas' ? '1' : '',
    filtrosAplicadosNotas.situacaoSitram,
    filtrosAplicadosNotas.daeSitram !== 'todos' ? '1' : '',
    filtrosAplicadosNotas.daeVencInicio,
    filtrosAplicadosNotas.daeVencFim,
    filtrosAplicadosNotas.foraCe15SemDae ? '1' : '',
    filtrosAplicadosNotas.situacoes.length > 0 ? '1' : '',
    filtrosAplicadosNotas.origens.length > 0 ? '1' : '',
    filtrosAplicadosNotas.manifestos.length > 0 ? '1' : '',
    filtrosAplicadosNotas.modalidades.length > 0 ? '1' : '',
    filtrosAplicadosNotas.etiquetas.length > 0 ? '1' : '',
    filtrosAplicadosNotas.excluirEmitentes.length > 0 ? '1' : '',
  ].filter(Boolean).length;

  const filtrosPendentes =
    filtrosAplicadosNotas.numero !== filtroNumero ||
    filtrosAplicadosNotas.chave !== filtroChave ||
    filtrosAplicadosNotas.serie !== filtroSerie ||
    filtrosAplicadosNotas.cnpjId !== filtroCnpjId ||
    filtrosAplicadosNotas.status !== filtroStatus ||
    filtrosAplicadosNotas.emitente !== filtroEmitente ||
    filtrosAplicadosNotas.destinatario !== filtroDestinatario ||
    filtrosAplicadosNotas.valorMin !== filtroValorMin ||
    filtrosAplicadosNotas.valorMax !== filtroValorMax ||
    filtrosAplicadosNotas.itensMin !== filtroItensMin ||
    filtrosAplicadosNotas.itensMax !== filtroItensMax ||
    filtrosAplicadosNotas.dataInicio !== filtroDataInicio ||
    filtrosAplicadosNotas.dataFim !== filtroDataFim ||
    filtrosAplicadosNotas.dataEntradaInicio !== filtroDataEntradaInicio ||
    filtrosAplicadosNotas.dataEntradaFim !== filtroDataEntradaFim ||
    filtrosAplicadosNotas.mes !== filtroMes ||
    filtrosAplicadosNotas.ano !== filtroAno ||
    filtrosAplicadosNotas.situacao !== filtroSituacao ||
    filtrosAplicadosNotas.situacaoSitram !== filtroSituacaoSitram ||
    filtrosAplicadosNotas.daeSitram !== filtroDaeSitram ||
    filtrosAplicadosNotas.daeVencInicio !== filtroDaeVencInicio ||
    filtrosAplicadosNotas.daeVencFim !== filtroDaeVencFim ||
    filtrosAplicadosNotas.foraCe15SemDae !== filtroForaCe15SemDae ||
    filtrosAplicadosNotas.situacoes.join('\u0001') !== filtroSituacoes.join('\u0001') ||
    filtrosAplicadosNotas.origens.join('\u0001') !== filtroOrigens.join('\u0001') ||
    filtrosAplicadosNotas.manifestos.join('\u0001') !== filtroManifestos.join('\u0001') ||
    filtrosAplicadosNotas.modalidades.join('\u0001') !== filtroModalidades.join('\u0001') ||
    filtrosAplicadosNotas.etiquetas.join('\u0001') !== filtroEtiquetas.join('\u0001') ||
    filtrosAplicadosNotas.excluirEmitentes.join('\u0001') !== filtroExcluirEmitentes.join('\u0001');
  // Há alguma busca/filtro ativo? (inclui empresa, status e a busca por número)
  const algumFiltroAtivo =
    filtrosAplicadosAtivos > 0 ||
    filtrosAplicadosNotas.numero.trim() !== '' ||
    filtrosAplicadosNotas.cnpjId !== 'todos' ||
    filtrosAplicadosNotas.status !== 'todos';

  // Paginação no servidor só na visão padrão (sem filtro).
  const usandoPaginacaoServidor =
    porPagina > 0 &&
    anoCarregado === null &&
    !todasCarregadas &&
    !algumFiltroAtivo;
  const totalPaginasServidor = porPagina > 0 ? Math.max(1, Math.ceil(totalNotas / porPagina)) : 1;

  // Atualiza uma única nota já carregada (ex.: depois de manifestar, consultar
  // SITRAM ou pagamento ICMS) sem depender de router.refresh()/reload da
  // página inteira — a tela reflete o resultado assim que a busca terminar.
  const atualizarNotaLocal = useCallback((notaAtualizada: NotaComCnpj) => {
    notasEstendidasRef.current = true;
    setNotas((atuais) => atuais.map((n) => (n.id === notaAtualizada.id ? notaAtualizada : n)));
    setNotasAlerta((atuais) => atuais.map((n) => (n.id === notaAtualizada.id ? notaAtualizada : n)));
  }, []);

  const carregarTodasNotasEmSegundoPlano = useCallback(async () => {
    if (todasCarregadas || carregandoTodas || anoCarregado !== null) return;
    notasEstendidasRef.current = true;
    setCarregandoTodas(true);
    try {
      const todas = await listarTodasNotas();
      startTransition(() => {
        setNotas(todas as NotaComCnpj[]);
        setNotasAlerta(todas as NotaComCnpj[]);
        setTodasCarregadas(true);
      });
    } finally {
      setCarregandoTodas(false);
    }
  }, [todasCarregadas, carregandoTodas, anoCarregado, startTransition]);

  function montarFiltrosNotas(overrides: Partial<FiltrosNotasAplicados> = {}): FiltrosNotasAplicados {
    return {
      numero: filtroNumero,
      chave: filtroChave,
      serie: filtroSerie,
      cnpjId: filtroCnpjId,
      status: filtroStatus,
      emitente: filtroEmitente,
      destinatario: filtroDestinatario,
      valorMin: filtroValorMin,
      valorMax: filtroValorMax,
      itensMin: filtroItensMin,
      itensMax: filtroItensMax,
      etiquetas: [...filtroEtiquetas],
      excluirEmitentes: [...filtroExcluirEmitentes],
      dataInicio: filtroDataInicio,
      dataFim: filtroDataFim,
      dataEntradaInicio: filtroDataEntradaInicio,
      dataEntradaFim: filtroDataEntradaFim,
      mes: filtroMes,
      ano: filtroAno,
      situacao: filtroSituacao,
      situacaoSitram: filtroSituacaoSitram,
      daeSitram: filtroDaeSitram,
      daeVencInicio: filtroDaeVencInicio,
      daeVencFim: filtroDaeVencFim,
      foraCe15SemDae: filtroForaCe15SemDae,
      situacoes: [...filtroSituacoes],
      origens: [...filtroOrigens],
      manifestos: [...filtroManifestos],
      modalidades: [...filtroModalidades],
      ...overrides,
    };
  }

  function aplicarFiltrosNotas(overrides: Partial<FiltrosNotasAplicados> = {}) {
    // Aplica o filtro imediatamente sobre o que já está carregado; o
    // carregamento completo (se necessário) roda em segundo plano e a
    // lista se atualiza sozinha quando terminar (notasFiltradas depende de `notas`).
    notasEstendidasRef.current = true;
    if (!todasCarregadas && anoCarregado === null) {
      void carregarTodasNotasEmSegundoPlano();
    }

    setFiltrosAplicadosNotas(montarFiltrosNotas(overrides));
    setPaginaCliente(1);
    setStatus({ success: true, message: 'Busca/filtros aplicados.' });
  }

  function filtrarErroImportacaoNotas() {
    const situacoes: FiltroSituacaoNota[] = ['com-erro'];
    setMostrarFiltros(true);
    setModoFiltroNotas('avancado');
    setFiltroSituacoes(situacoes);
    setFiltroDaeSitram('nao-encontrada');
    void aplicarFiltrosNotas({ situacoes, daeSitram: 'nao-encontrada' });
  }

  function filtrarXmlCompletoNotas() {
    setMostrarFiltros(true);
    setModoFiltroNotas('avancado');
    setFiltroStatus('COMPLETA');
    setFiltroSituacoes(['efetivada']);
    void aplicarFiltrosNotas({ status: 'COMPLETA', situacoes: ['efetivada'] });
  }

  function abrirInclusaoNotas() {
    setSecaoAtual('notas');
    setMostrarImport(true);
  }

  useEffect(() => {
    if (!algumFiltroAtivo) return;
    void carregarTodasNotasEmSegundoPlano();
  }, [algumFiltroAtivo, carregarTodasNotasEmSegundoPlano]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (secaoAtual !== 'notas' || algumFiltroAtivo || todasCarregadas || carregandoTodas || anoCarregado !== null) return;

    const timer = window.setTimeout(() => {
      void carregarTodasNotasEmSegundoPlano();
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [
    secaoAtual,
    algumFiltroAtivo,
    todasCarregadas,
    carregandoTodas,
    anoCarregado,
    carregarTodasNotasEmSegundoPlano,
  ]);

  const carregarMaisRelatorio = useCallback(async () => {
    if (carregandoRelatorio || !temMaisRelatorio) return;
    setCarregandoRelatorio(true);
    try {
      const resultado = await listarNotasRelatorio(paginaRelatorio + 1, TAMANHO_PAGINA_RELATORIO);
      startTransition(() => {
        setNotasRelatorio((atuais) => {
          const ids = new Set(atuais.map((nota) => nota.id));
          return [...atuais, ...resultado.notas.filter((nota) => !ids.has(nota.id))];
        });
        setPaginaRelatorio(resultado.pagina);
        setTotalRelatorio(resultado.total);
        setTemMaisRelatorio(resultado.temMais);
      });
    } catch (error: unknown) {
      setStatus({
        success: false,
        message: (error as Error).message || 'Erro ao carregar os relatórios.',
      });
    } finally {
      setCarregandoRelatorio(false);
    }
  }, [carregandoRelatorio, temMaisRelatorio, paginaRelatorio, startTransition]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (secaoAtual !== 'relatorios' || carregandoRelatorio || !temMaisRelatorio) return;

    const timer = window.setTimeout(() => {
      void carregarMaisRelatorio();
    }, paginaRelatorio === 0 ? 0 : 250);

    return () => window.clearTimeout(timer);
  }, [secaoAtual, paginaRelatorio, carregandoRelatorio, temMaisRelatorio, carregarMaisRelatorio]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const atual = resizeColunaRef.current;
      if (!atual) return;
      const delta = event.clientX - atual.inicioX;
      setLargurasColunas((prev) => ({
        ...prev,
        [atual.coluna]: Math.max(LARGURA_MIN_COLUNA[atual.coluna], atual.larguraInicial + delta),
      }));
    }

    function handleMouseUp() {
      resizeColunaRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  function iniciarResizeColuna(coluna: ColunaRedimensionavel, event: React.MouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();
    resizeColunaRef.current = {
      coluna,
      inicioX: event.clientX,
      larguraInicial: largurasColunas[coluna],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function limparFiltrosAvancados() {
    setFiltroNumero('');
    setFiltroChave('');
    setFiltroSerie('');
    setFiltroEmitente('');
    setFiltroDestinatario('');
    setFiltroValorMin('');
    setFiltroValorMax('');
    setFiltroItensMin('');
    setFiltroItensMax('');
    setFiltroDataInicio('');
    setFiltroDataFim('');
    setFiltroDataEntradaInicio('');
    setFiltroDataEntradaFim('');
    setFiltroMes('');
    setFiltroAnoState('');
    setFiltroCnpjId('todos');
    setFiltroStatus('todos');
    setNotas(notasIniciais);
    setNotasAlerta(notasAlertaIniciais);
    setAnoCarregado(null);
    setTodasCarregadas(notasIniciais.length >= totalNotas);
    setFiltroSituacao('todas');
    setFiltroSituacaoSitram('');
    setFiltroDaeSitram('todos');
    setFiltroDaeVencInicio('');
    setFiltroDaeVencFim('');
    setFiltroForaCe15SemDae(false);
    setFiltroSituacoes([]);
    setFiltroOrigens([]);
    setFiltroManifestos([]);
    setFiltroModalidades([]);
    setFiltroEtiquetas([]);
    setFiltroExcluirEmitentes([]);
    setExcluirEmitenteInput('');
    setFiltrosAplicadosNotas(filtrosNotasPadrao());
    setPaginaCliente(1);
  }

  function filtrarVencimentoDae(inicio: string, fim: string) {
    setFiltroDaeSitram('a-pagar');
    setFiltroDaeVencInicio(inicio);
    setFiltroDaeVencFim(fim);
    setMostrarFiltros(true);
    setModoFiltroNotas('avancado');
    aplicarFiltrosNotas({ daeSitram: 'a-pagar', daeVencInicio: inicio, daeVencFim: fim });
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        document.getElementById('lista-notas-resultados')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function abrirCertificados() {
    if (certs) return setCerts(null);
    setCarregandoCerts(true);
    lerCertificados().then((res) => {
      if (res.ok) setCerts(res.certificados);
      else setStatus({ success: false, message: res.message });
      setCarregandoCerts(false);
    });
  }

  function handleVincularCerts() {
    startTransition(async () => {
      const res = await vincularCertificados();
      setStatus(res);
      if (res.success) {
        const r = await lerCertificados();
        if (r.ok) setCerts(r.certificados);
        router.refresh();
      }
    });
  }

  function handleEnviarCertificado(formData: FormData) {
    startTransition(async () => {
      const res = await enviarCertificadoVps(formData);
      setStatus(res);
      if (res.success) {
        setMostrarUploadCert(false);
        const r = await lerCertificados();
        if (r.ok) setCerts(r.certificados);
        router.refresh();
      }
    });
  }

  function abrirUsuariosAdmin() {
    setSecaoAtual('usuarios');
    setMostrarUsuarios(true);
    if (usuariosAdmin) return;

    setCarregandoUsuarios(true);
    listarUsuariosAdmin()
      .then((usuarios) => setUsuariosAdmin(usuarios))
      .catch((error) => setStatus({ success: false, message: (error as Error).message || 'Erro ao listar usuarios.' }))
      .finally(() => setCarregandoUsuarios(false));
  }

  function handleSalvarUsuario(formData: FormData) {
    startTransition(async () => {
      const res = await salvarUsuarioAdmin(formData);
      setStatus(res);
      if (res.success) {
        setUsuarioEditando(null);
        setUsuariosAdmin(await listarUsuariosAdmin());
      }
    });
  }

  function executar(acao: () => Promise<ActionResult>) {
    startTransition(async () => setStatus(await acao()));
  }

  function handleAdicionarCnpj(formData: FormData) {
    startTransition(async () => {
      const res = await adicionarCnpj(formData);
      setStatus(res);
      if (res.success) setMostrarForm(false);
    });
  }

  const filtroNumeroBusca = filtrosAplicadosNotas.numero;
  const filtroChaveBusca = filtrosAplicadosNotas.chave;
  const filtroSerieBusca = filtrosAplicadosNotas.serie;
  const filtroCnpjIdBusca = filtrosAplicadosNotas.cnpjId;
  const filtroStatusBusca = filtrosAplicadosNotas.status;
  const filtroEmitenteBusca = filtrosAplicadosNotas.emitente;
  const filtroDestinatarioBusca = filtrosAplicadosNotas.destinatario;
  const filtroValorMinBusca = filtrosAplicadosNotas.valorMin;
  const filtroValorMaxBusca = filtrosAplicadosNotas.valorMax;
  const filtroItensMinBusca = filtrosAplicadosNotas.itensMin;
  const filtroItensMaxBusca = filtrosAplicadosNotas.itensMax;
  const filtroDataInicioBusca = filtrosAplicadosNotas.dataInicio;
  const filtroDataFimBusca = filtrosAplicadosNotas.dataFim;
  const filtroDataEntradaInicioBusca = filtrosAplicadosNotas.dataEntradaInicio;
  const filtroDataEntradaFimBusca = filtrosAplicadosNotas.dataEntradaFim;
  const filtroMesBusca = filtrosAplicadosNotas.mes;
  const filtroAnoBusca = filtrosAplicadosNotas.ano;
  const filtroSituacaoBusca = filtrosAplicadosNotas.situacao;
  const filtroSituacaoSitramBusca = filtrosAplicadosNotas.situacaoSitram;
  const filtroDaeSitramBusca = filtrosAplicadosNotas.daeSitram;
  const filtroDaeVencInicioBusca = filtrosAplicadosNotas.daeVencInicio;
  const filtroDaeVencFimBusca = filtrosAplicadosNotas.daeVencFim;
  const filtroForaCe15SemDaeBusca = filtrosAplicadosNotas.foraCe15SemDae;
  const filtroSituacoesBusca = filtrosAplicadosNotas.situacoes;
  const filtroOrigensBusca = filtrosAplicadosNotas.origens;
  const filtroManifestosBusca = filtrosAplicadosNotas.manifestos;
  const filtroModalidadesBusca = filtrosAplicadosNotas.modalidades;
  const filtroEtiquetasBusca = filtrosAplicadosNotas.etiquetas;
  const filtroExcluirEmitentesBusca = filtrosAplicadosNotas.excluirEmitentes;
  const notasBuscaIndex = useMemo(() => new Map(notas.map((n) => [
    n.id,
    {
      numero: numeroNotaBusca(n),
      serie: String(Number(serieNotaSistema(n)) || serieNotaSistema(n).replace(/^0+/, '') || ''),
      emitenteNome: normalizarBuscaFiltro(n.emitenteNome ?? ''),
      emitenteCnpj: n.emitenteCnpj ?? '',
      destNome: normalizarBuscaFiltro(n.destNome ?? ''),
      destCnpj: n.destCnpj ?? '',
      emitidaEm: new Date(n.emitidaEm),
      entradaEm: new Date(n.createdAt),
      etiquetas: parseEtiquetas(n.etiqueta),
      modalidades: modalidadesDaNota(n),
      situacaoSitram: situacaoSitramEfetiva(n) ?? '',
      dae: statusDaeEfetivo(n),
      suspeitasDuplicidade: extrairPagamentoIcmsSitram(n).suspeitasDuplicidade.length,
    },
  ])), [notas]);

  const notasFiltradas = useMemo(() => {
    const numeroBusca = filtroNumeroBusca.trim();
    const numeroBuscaDigitos = numeroBusca.replace(/\D/g, '');
    const chaveBuscaDigitos = filtroChaveBusca.replace(/\D/g, '');
    const serieBuscaNormalizada = filtroSerieBusca.replace(/\D/g, '').replace(/^0+/, '');
    const emitenteBusca = normalizarBuscaFiltro(filtroEmitenteBusca);
    const emitenteBuscaDigitos = filtroEmitenteBusca.replace(/\D/g, '');
    const destBusca = normalizarBuscaFiltro(filtroDestinatarioBusca);
    const destBuscaDigitos = filtroDestinatarioBusca.replace(/\D/g, '');
    const valorMin = filtroValorMinBusca ? Number(filtroValorMinBusca) : null;
    const valorMax = filtroValorMaxBusca ? Number(filtroValorMaxBusca) : null;
    const itensMin = filtroItensMinBusca ? Number(filtroItensMinBusca) : null;
    const itensMax = filtroItensMaxBusca ? Number(filtroItensMaxBusca) : null;

    return notas.filter((n) => {
      const idx = notasBuscaIndex.get(n.id);
      if (!idx) return false;
      if (filtroCnpjIdBusca !== 'todos' && n.cnpjId !== filtroCnpjIdBusca) return false;
      if (filtroStatusBusca !== 'todos' && n.status !== filtroStatusBusca) return false;
      if (chaveBuscaDigitos && !n.chave.includes(chaveBuscaDigitos)) return false;
      if (serieBuscaNormalizada && idx.serie !== serieBuscaNormalizada) return false;

      // Busca por número da NF (ignora zeros à esquerda) ou por chave de acesso.
      if (numeroBuscaDigitos) {
        const alvoBusca = String(Number(numeroBuscaDigitos) || '');
        const matchNumero = idx.numero.length > 0 && idx.numero.includes(alvoBusca);
        const matchNumeroSerie = idx.numero.length > 0 && idx.serie.length > 0 && `${idx.numero}${idx.serie}`.includes(alvoBusca);
        const matchChave = numeroBuscaDigitos.length >= 8 && n.chave.includes(numeroBuscaDigitos);
        if (!matchNumero && !matchNumeroSerie && !matchChave) return false;
      }

      if (emitenteBusca) {
        const nomeAlvo = idx.emitenteNome;
        const matchNome = nomeAlvo.length > 0 && (nomeAlvo.includes(emitenteBusca) || emitenteBusca.includes(nomeAlvo));
        const matchCnpj = emitenteBuscaDigitos.length >= 3 && idx.emitenteCnpj.includes(emitenteBuscaDigitos);
        if (!matchNome && !matchCnpj) return false;
      }
      if (destBusca) {
        const nomeAlvo = idx.destNome;
        const matchNome = nomeAlvo.length > 0 && (nomeAlvo.includes(destBusca) || destBusca.includes(nomeAlvo));
        const matchCnpj = destBuscaDigitos.length >= 3 && idx.destCnpj.includes(destBuscaDigitos);
        if (!matchNome && !matchCnpj) return false;
      }

      const valor = n.valorTotal ?? 0;
      if (valorMin !== null && !Number.isNaN(valorMin) && valor < valorMin) return false;
      if (valorMax !== null && !Number.isNaN(valorMax) && valor > valorMax) return false;

      const qtdItens = n.qtdItens ?? 0;
      if (itensMin !== null && !Number.isNaN(itensMin) && qtdItens < itensMin) return false;
      if (itensMax !== null && !Number.isNaN(itensMax) && qtdItens > itensMax) return false;

      if (filtroEtiquetasBusca.length > 0) {
        const corresponde = filtroEtiquetasBusca.some((f) =>
          f === 'sem-etiqueta' ? idx.etiquetas.length === 0 : idx.etiquetas.includes(f)
        );
        if (!corresponde) return false;
      }

      if (filtroExcluirEmitentesBusca.length > 0) {
        const nomeEmit = normalizarBuscaFiltro(n.emitenteNome ?? '');
        const cnpjEmit = n.emitenteCnpj ?? '';
        const excluida = filtroExcluirEmitentesBusca.some((ex) => {
          const digitos = ex.replace(/\D/g, '');
          if (digitos.length >= 14) return cnpjEmit === digitos.slice(-14);
          const nomeEx = ex.split(/\s[—-]\s/)[0].trim().toLowerCase();
          const nomeExBusca = normalizarBuscaFiltro(nomeEx);
          return nomeExBusca.length > 0 && (nomeEmit.includes(nomeExBusca) || nomeExBusca.includes(nomeEmit));
        });
        if (excluida) return false;
      }

      // Filtros por data de emissão
      if (filtroDataInicioBusca && idx.emitidaEm < new Date(filtroDataInicioBusca)) return false;
      if (filtroDataFimBusca && idx.emitidaEm > new Date(filtroDataFimBusca + 'T23:59:59')) return false;
      if (filtroDataEntradaInicioBusca && idx.entradaEm < new Date(filtroDataEntradaInicioBusca)) return false;
      if (filtroDataEntradaFimBusca && idx.entradaEm > new Date(filtroDataEntradaFimBusca + 'T23:59:59')) return false;
      if (filtroMesBusca && idx.emitidaEm.getMonth() + 1 !== Number(filtroMesBusca)) return false;
      if (filtroAnoBusca && idx.emitidaEm.getFullYear() !== Number(filtroAnoBusca)) return false;

      // Filtro por situação SEFAZ
      if (filtroSituacaoBusca !== 'todas') {
        const situacao = n.situacaoSefaz ?? 'AUTORIZADA';
        if (situacao !== filtroSituacaoBusca) return false;
      }

      if (filtroSituacaoSitramBusca && normalizarBuscaFiltro(idx.situacaoSitram) !== normalizarBuscaFiltro(filtroSituacaoSitramBusca)) {
        return false;
      }

      if (filtroSituacoesBusca.length > 0) {
        const situacoes: FiltroSituacaoNota[] = [];
        const situacaoSefaz = n.situacaoSefaz ?? 'AUTORIZADA';
        if (idx.suspeitasDuplicidade > 0) situacoes.push('inconsistente');
        if (n.status === 'COMPLETA' && situacaoSefaz === 'AUTORIZADA') situacoes.push('efetivada');
        if (situacaoSefaz === 'DENEGADA') situacoes.push('denegada');
        if (n.status === 'RESUMO' && !n.manifestadaEm) situacoes.push('pendente-conferencia');
        if (idx.dae === 'NAO_ENCONTRADA' || idx.suspeitasDuplicidade > 0) situacoes.push('com-erro');
        if (n.status === 'RESUMO' && n.manifestadaEm) situacoes.push('pendente-recepcao');
        if (situacaoSefaz === 'CANCELADA') situacoes.push('cancelada');
        if (n.status === 'RESUMO') situacoes.push('pendente');
        if (!filtroSituacoesBusca.some((situacao) => situacoes.includes(situacao))) return false;
      }

      if (filtroOrigensBusca.length > 0) {
        const origem: FiltroOrigemNota = raizCnpj(n.emitenteCnpj) === raizCnpj(n.cnpj.cnpj) ? 'proprio' : 'terceiro';
        if (!filtroOrigensBusca.includes(origem)) return false;
      }

      if (filtroManifestosBusca.length > 0) {
        const manifestos: FiltroManifestoNota[] = [];
        if (n.manifestadaEm) manifestos.push('manifestada');
        if (!n.manifestadaEm) manifestos.push('nao-manifestada');
        if (n.manifestadaEm && n.status === 'RESUMO') manifestos.push('pendente-processando');
        if (idx.dae === 'NAO_ENCONTRADA' || idx.suspeitasDuplicidade > 0) manifestos.push('com-erros');
        if (!filtroManifestosBusca.some((manifesto) => manifestos.includes(manifesto))) return false;
      }

      if (filtroModalidadesBusca.length > 0 && !idx.modalidades.some((modalidade) => filtroModalidadesBusca.includes(modalidade))) {
        return false;
      }

      if (filtroDaeSitramBusca !== 'todos') {
        const dae = idx.dae;
        const consultada = !!n.sitramConsultadaEm || !!dae;
        const temDae = ['PAGO', 'EM_ABERTO', 'LIBERADA_PARA_GERAR'].includes(dae);
        if (filtroDaeSitramBusca === 'consultado' && !consultada) return false;
        if (filtroDaeSitramBusca === 'sem-consulta' && consultada) return false;
        if (filtroDaeSitramBusca === 'com-dae' && !temDae) return false;
        if (filtroDaeSitramBusca === 'a-pagar' && !DAE_A_PAGAR.includes(dae)) return false;
        if (filtroDaeSitramBusca === 'em-aberto' && dae !== 'EM_ABERTO') return false;
        if (filtroDaeSitramBusca === 'pago' && dae !== 'PAGO') return false;
        if (filtroDaeSitramBusca === 'duplicidade' && idx.suspeitasDuplicidade === 0) return false;
        if (filtroDaeSitramBusca === 'sem-dae' && dae !== 'SEM_DAE') return false;
        if (filtroDaeSitramBusca === 'nao-encontrada' && dae !== 'NAO_ENCONTRADA') return false;
      }

      if (filtroDaeVencInicioBusca || filtroDaeVencFimBusca) {
        const lancamentos = daePorNota.get(n.id)?.lancamentos ?? [];
        const dentroDoIntervalo = lancamentos.some((lancamento) => {
          const vencimento = chaveDataLocal(lancamento.vencimento);
          if (!vencimento) return false;
          if (filtroDaeVencInicioBusca && vencimento < filtroDaeVencInicioBusca) return false;
          if (filtroDaeVencFimBusca && vencimento > filtroDaeVencFimBusca) return false;
          return true;
        });
        if (!dentroDoIntervalo) return false;
      }

      if (filtroForaCe15SemDaeBusca && !notaForaCeMais15DiasSemDaeOuPagamento(n)) return false;

      return true;
    });
  }, [
    notas,
    notasBuscaIndex,
    filtroCnpjIdBusca,
    filtroStatusBusca,
    filtroNumeroBusca,
    filtroChaveBusca,
    filtroSerieBusca,
    filtroEmitenteBusca,
    filtroDestinatarioBusca,
    filtroValorMinBusca,
    filtroValorMaxBusca,
    filtroItensMinBusca,
    filtroItensMaxBusca,
    filtroDataInicioBusca,
    filtroDataFimBusca,
    filtroDataEntradaInicioBusca,
    filtroDataEntradaFimBusca,
    filtroMesBusca,
    filtroAnoBusca,
    filtroSituacaoBusca,
    filtroSituacaoSitramBusca,
    filtroDaeSitramBusca,
    filtroDaeVencInicioBusca,
    filtroDaeVencFimBusca,
    daePorNota,
    filtroForaCe15SemDaeBusca,
    filtroSituacoesBusca,
    filtroOrigensBusca,
    filtroManifestosBusca,
    filtroModalidadesBusca,
    filtroEtiquetasBusca,
    filtroExcluirEmitentesBusca,
  ]);

  const [paginaCliente, setPaginaCliente] = useState(1);

  useEffect(() => {
    setPaginaCliente(1);
  }, [
    notas,
    filtroCnpjIdBusca,
    filtroStatusBusca,
    filtroNumeroBusca,
    filtroChaveBusca,
    filtroSerieBusca,
    filtroEmitenteBusca,
    filtroDestinatarioBusca,
    filtroValorMinBusca,
    filtroValorMaxBusca,
    filtroItensMinBusca,
    filtroItensMaxBusca,
    filtroDataInicioBusca,
    filtroDataFimBusca,
    filtroDataEntradaInicioBusca,
    filtroDataEntradaFimBusca,
    filtroMesBusca,
    filtroAnoBusca,
    filtroSituacaoBusca,
    filtroDaeSitramBusca,
    filtroDaeVencInicioBusca,
    filtroDaeVencFimBusca,
    filtroForaCe15SemDaeBusca,
    filtroSituacoesBusca,
    filtroOrigensBusca,
    filtroManifestosBusca,
    filtroModalidadesBusca,
    filtroEtiquetasBusca,
    filtroExcluirEmitentesBusca,
  ]);

  const semPaginacaoCliente = porPagina <= 0;
  const totalPaginasCliente = semPaginacaoCliente ? 1 : Math.max(1, Math.ceil(notasFiltradas.length / porPagina));
  const paginaClienteSegura = semPaginacaoCliente ? 1 : Math.min(paginaCliente, totalPaginasCliente);
  const notasVisiveis = useMemo(() => {
    if (semPaginacaoCliente) return notasFiltradas;
    const inicio = (paginaClienteSegura - 1) * porPagina;
    return notasFiltradas.slice(inicio, inicio + porPagina);
  }, [notasFiltradas, paginaClienteSegura, porPagina, semPaginacaoCliente]);
  const totalFiltrado = useMemo(
    () => notasFiltradas.reduce((acc, n) => acc + (n.valorTotal ?? 0), 0),
    [notasFiltradas]
  );
  const resumoOperacionalHome = useMemo(() => {
    const agora = new Date();
    const daeAbertos = notasAlerta.filter((nota) => DAE_A_PAGAR.includes(statusDaeEfetivo(nota))).length;
    const daeVencidos = notasAlerta.filter((nota) => {
      const lancamentos = lancamentosVisiveisDae(extrairResumoDae(nota).lancamentos);
      return lancamentos.some((lancamento) => !lancamento.pago && (diasAteVencimento(lancamento.vencimento) ?? 0) < 0);
    }).length;
    const empresasAtivas = cnpjs.filter((cnpj) => cnpj.ativo).length;
    const empresasComAtencao = cnpjs.filter((cnpj) => {
      if (!cnpj.ativo) return false;
      if (cnpj.bloqueadoAte && new Date(cnpj.bloqueadoAte) > agora) return true;
      return !cnpj.ultimaBusca || agora.getTime() - new Date(cnpj.ultimaBusca).getTime() > 36 * 60 * 60 * 1000;
    }).length;
    const ultimaSincronizacao = cnpjs.reduce<Date | null>((maisRecente, cnpj) => {
      if (!cnpj.ultimaBusca) return maisRecente;
      const atual = new Date(cnpj.ultimaBusca);
      return !maisRecente || atual > maisRecente ? atual : maisRecente;
    }, null);

    return { daeAbertos, daeVencidos, empresasAtivas, empresasComAtencao, ultimaSincronizacao };
  }, [cnpjs, notasAlerta]);

  const notasRecentesHome = useMemo(
    () => [...notas].sort((a, b) => new Date(b.emitidaEm).getTime() - new Date(a.emitidaEm).getTime()).slice(0, 5),
    [notas]
  );
  const [buscaGlobalHome, setBuscaGlobalHome] = useState('');
  const [resultadosBuscaHome, setResultadosBuscaHome] = useState<NotaComCnpj[]>([]);
  const [buscandoGlobalHome, setBuscandoGlobalHome] = useState(false);

  async function buscarGlobalHome() {
    const termo = buscaGlobalHome.trim();
    if (!termo) {
      setResultadosBuscaHome([]);
      return;
    }

    setBuscandoGlobalHome(true);
    try {
      const base = todasCarregadas ? notas : await listarTodasNotas() as NotaComCnpj[];
      if (!todasCarregadas) {
        setNotas(base);
        setNotasAlerta(base);
        setTodasCarregadas(true);
      }

      const busca = normalizarBuscaFiltro(termo);
      const digitos = termo.replace(/\D/g, '');
      const resultados = base.filter((nota) => {
        const texto = normalizarBuscaFiltro([
          numeroNotaSistema(nota),
          serieNotaSistema(nota),
          nota.chave,
          nota.emitenteNome,
          nota.emitenteCnpj,
          nota.destNome,
          nota.destCnpj,
          nota.cnpj.razaoSocial,
          nota.cnpj.cnpj,
        ].filter(Boolean).join(' '));
        const numeros = [nota.chave, nota.emitenteCnpj, nota.destCnpj, nota.cnpj.cnpj].join('').replace(/\D/g, '');
        return texto.includes(busca) || (digitos.length >= 3 && numeros.includes(digitos));
      });
      setResultadosBuscaHome(resultados.slice(0, 10));
    } finally {
      setBuscandoGlobalHome(false);
    }
  }

  function abrirResultadoBuscaHome(nota: NotaComCnpj) {
    const numero = numeroNotaSistema(nota);
    setFiltroNumero(numero);
    setFiltroChave(nota.chave);
    setSecaoAtual('notas');
    setMostrarFiltros(true);
    void aplicarFiltrosNotas({ numero, chave: nota.chave });
  }

  function abrirFilaNotasHome(filtros: Partial<FiltrosNotasAplicados>) {
    setSecaoAtual('notas');
    setMostrarFiltros(true);
    if (filtros.status) setFiltroStatus(filtros.status);
    if (filtros.daeSitram) setFiltroDaeSitram(filtros.daeSitram);
    void aplicarFiltrosNotas(filtros);
  }
  // Manifestação em lote
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [manifestoLoteProgresso, setManifestoLoteProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [manifestoLoteResumoState, setManifestoLoteResumo] = useState<Record<string, number> | null>(null);
  const [manifestoLoteErros, setManifestoLoteErros] = useState<Array<{ chave: string; detalhe: string }> | null>(null);
  const [consultandoPagamentoLote, setConsultandoPagamentoLote] = useState(false);
  const [pagamentoLoteResultado, setPagamentoLoteResultado] = useState<ResultadoPagamentoIcmsLote | null>(null);
  const [painelPagamentoLoteAberto, setPainelPagamentoLoteAberto] = useState(true);
  const [painelManifestoLoteAberto, setPainelManifestoLoteAberto] = useState(true);
  const [etiquetasLote, setEtiquetasLote] = useState<string[]>([]);
  const [aplicandoEtiquetasLote, setAplicandoEtiquetasLote] = useState(false);
  const manifestoLoteResumo = manifestoLoteResumoState ?? {};
  const manifestoLoteTemResumo = manifestoLoteResumoState !== null;
  const manifestoLoteErrosLista = manifestoLoteErros ?? [];

  const notasPagamentoIcmsElegiveis = useMemo(
    () => notasFiltradas.filter((nota) => notaElegivelConsultaPagamentoIcms(nota)),
    [notasFiltradas]
  );

  const notasManifestaveis = useMemo(
    () =>
      notasFiltradas.filter(
        (n) =>
          n.status === 'RESUMO' &&
          !n.manifestadaEm &&
          n.situacaoSefaz !== 'CANCELADA' &&
          n.situacaoSefaz !== 'DENEGADA' &&
          notaDentroPrazoManifestacao(n)
      ),
    [notasFiltradas]
  );

  const todasVisiveisSelecionadas = notasVisiveis.length > 0 && notasVisiveis.every((n) => selecionadas.has(n.id));
  const selecionadasManifestaveisQtd = notasManifestaveis.filter((nota) => selecionadas.has(nota.id)).length;

  function toggleSelecionada(id: number) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const todasSelecionadas = notasManifestaveis.length > 0 && notasManifestaveis.every((n) => selecionadas.has(n.id));

  function toggleSelecionarTodas() {
    setSelecionadas(todasSelecionadas ? new Set() : new Set(notasManifestaveis.map((n) => n.id)));
  }

  function handleGerarApiKey(formData: FormData) {
    startTransition(async () => {
      const res: ApiKeyCriada = await gerarApiKey(formData);
      setStatus(res);
      if (res.success) {
        setApiTokenGerado(res.token ?? null);
        setApiKeys(await listarApiKeys());
      }
    });
  }

  function handleRevogarApiKey(id: number) {
    startTransition(async () => {
      const res = await revogarApiKey(id);
      setStatus(res);
      if (res.success) setApiKeys(await listarApiKeys());
    });
  }

  async function copiarTexto(valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setStatus({ success: true, message: 'Copiado.' });
    } catch {
      setStatus({ success: false, message: 'Nao consegui copiar automaticamente.' });
    }
  }

  function toggleSelecionarVisiveis() {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (todasVisiveisSelecionadas) {
        for (const nota of notasVisiveis) next.delete(nota.id);
      } else {
        for (const nota of notasVisiveis) next.add(nota.id);
      }
      return next;
    });
  }

  function atualizarEtiquetasNotasLocal(ids: number[], etiquetas: string[], modo: 'adicionar' | 'alternar') {
    const idSet = new Set(ids);
    const atualizar = (nota: NotaComCnpj): NotaComCnpj => {
      if (!idSet.has(nota.id)) return nota;
      const atuais = parseEtiquetas(nota.etiqueta);
      const proximas = modo === 'adicionar'
        ? [...new Set([...atuais, ...etiquetas])]
        : etiquetas.reduce((lista, etiqueta) => (
            lista.includes(etiqueta) ? lista.filter((item) => item !== etiqueta) : [...lista, etiqueta]
          ), atuais);
      return { ...nota, etiqueta: proximas.length > 0 ? proximas.join(',') : null };
    };
    setNotas((atuais) => atuais.map(atualizar));
    setNotasAlerta((atuais) => atuais.map(atualizar));
  }

  function toggleEtiquetaLote(tag: string) {
    setEtiquetasLote((atuais) => atuais.includes(tag) ? atuais.filter((item) => item !== tag) : [...atuais, tag]);
  }

  async function handleAplicarEtiquetasLote() {
    const ids = [...selecionadas];
    if (ids.length === 0 || etiquetasLote.length === 0 || aplicandoEtiquetasLote) return;

    setAplicandoEtiquetasLote(true);
    atualizarEtiquetasNotasLocal(ids, etiquetasLote, 'adicionar');
    const res = await aplicarEtiquetasLote(ids, etiquetasLote);
    setAplicandoEtiquetasLote(false);
    setStatus({ success: res.success, message: res.message });
    if (!res.success) {
      router.refresh();
      return;
    }
    setSelecionadas(new Set());
    setEtiquetasLote([]);
  }

  async function handleManifestarLote() {
    const ids = [...selecionadas].filter((id) => notasManifestaveis.some((nota) => nota.id === id));
    if (ids.length === 0) return;

    setManifestoLoteResumo(null);
    setManifestoLoteErros(null);
    setManifestoLoteProgresso({ feito: 0, total: ids.length });
    const tally: Record<string, number> = {};
    const erros: Array<{ chave: string; detalhe: string }> = [];
    const LOTE = 5;

    for (let i = 0; i < ids.length; i += LOTE) {
      const grupo = ids.slice(i, i + LOTE);
      let res: ResultadoManifestoLote[];
      try {
        res = await manifestarNotasLote(grupo);
      } catch {
        res = grupo.map((notaId) => ({ notaId, chave: '', status: 'erro' as const, detalhe: 'Erro de rede ou servidor' }));
      }
      for (const r of res) {
        tally[r.status] = (tally[r.status] ?? 0) + 1;
        if (r.status === 'erro' && r.detalhe) {
          erros.push({ chave: r.chave || `id:${r.notaId}`, detalhe: r.detalhe });
        }
      }
      setManifestoLoteProgresso({ feito: Math.min(i + LOTE, ids.length), total: ids.length });
      setManifestoLoteResumo({ ...tally });
      if (erros.length > 0) setManifestoLoteErros([...erros]);
    }

    setSelecionadas(new Set());
    router.refresh();
    setStatus({ success: true, message: `Manifestação em lote concluída: ${ids.length} nota(s) processada(s).` });
  }

  async function handleConsultarPagamentoIcmsLote() {
    if (consultandoPagamentoLote) return;

    setConsultandoPagamentoLote(true);
    setPagamentoLoteResultado(null);
    try {
      const anoConsulta = filtroAno ? Number(filtroAno) : anoCarregado ?? undefined;
      const res = await consultarPagamentoIcmsLote({
        cnpjId: filtroCnpjId === 'todos' ? undefined : filtroCnpjId,
        ano: anoConsulta && Number.isFinite(anoConsulta) ? anoConsulta : undefined,
      });
      setPagamentoLoteResultado(res);
      setStatus({ success: res.success, message: res.message });

      if (res.success) {
        if (anoCarregado !== null) {
          const atualizadas = await listarNotasPorAno(anoCarregado);
          setNotas(atualizadas as NotaComCnpj[]);
          setNotasAlerta(atualizadas as NotaComCnpj[]);
        } else {
          router.refresh();
        }
      }
    } catch (error: unknown) {
      setStatus({ success: false, message: (error as Error).message || 'Erro ao consultar pagamento ICMS em lote.' });
    } finally {
      setConsultandoPagamentoLote(false);
    }
  }

  return (
    <div className="min-h-screen p-3 md:p-5 bg-[var(--ground)]">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <header className="rounded-xl bg-[var(--surface)] border border-[var(--border)] px-5 py-3.5 mb-4 shadow-sm flex flex-wrap gap-4 justify-between items-center">
          <div className="flex min-w-0 items-center">
            <Image
              src="/brand/danfe-collect-logo.svg"
              alt="Danfe Collect"
              width={720}
              height={170}
              priority
              className="h-auto w-[220px] max-w-[70vw]"
            />
            <span className="sr-only">{t('tagline')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setSecaoAtual('notas'); setMostrarImport((v) => !v); }}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
            >
              {t('keys')}
            </button>
            <button
              onClick={() => { setSecaoAtual('notas'); setMostrarPagamento((v) => !v); }}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
            >
              {t('payment')}
            </button>
            <button
              onClick={() => { setSecaoAtual('notas'); setMostrarSitram((v) => !v); }}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
            >
              SITRAM
            </button>
            <button
              onClick={() => handleRotinaMatinal(false)}
              disabled={pending || sitramConsultandoTudo || rotinaMatinalRodando}
              className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              {rotinaMatinalRodando || sitramConsultandoTudo ? t('updating') : t('updateAll')}
            </button>
            {podeAdministrar && (
              <>
                <button
                  onClick={() => { setSecaoAtual('configuracao'); setMostrarAdmin((v) => !v); }}
                  className="px-3.5 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
                >
                  {t('admin')}
                </button>
                {mostrarAdmin && (
                  <>
            <button
              onClick={() => setMostrarUploadCert((v) => !v)}
              disabled={pending}
              className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-amber-950 hover:bg-amber-400 transition disabled:opacity-50"
            >
              {mostrarUploadCert ? t('closeCertificate') : t('updateCertificate')}
            </button>
            <button
              onClick={abrirCertificados}
              disabled={carregandoCerts}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition disabled:opacity-50"
            >
              {carregandoCerts ? t('reading') : certs ? t('closeCertificates') : t('pcCertificates')}
            </button>
            <button
              onClick={() => executar(verificarCertificado)}
              disabled={pending}
              className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-150 transition disabled:opacity-50"
            >
              {t('checkCertificate')}
            </button>
            <button
              onClick={abrirUsuariosAdmin}
              disabled={carregandoUsuarios}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition disabled:opacity-50"
            >
              {carregandoUsuarios ? t('updating') : t('users')}
            </button>
                  </>
                )}
              </>
            )}
            <form action={sairUsuario} className="flex items-center gap-2 pl-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white grid place-items-center text-xs font-bold">
                  {usuario.nome.slice(0, 2).toUpperCase()}
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-[var(--ink)]">{usuario.nome}</div>
                  <div className="text-[11px] text-[var(--ink-mut)]">{usuario.admin ? 'admin' : t('operation')}</div>
                </div>
              </div>
              <button
                type="submit"
                className="px-3 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
              >
                {t('logout')}
              </button>
            </form>
            <select
              value={idioma}
              onChange={(e) => setIdioma(e.target.value === 'zh-CN' ? 'zh-CN' : 'pt-BR')}
              aria-label={t('language')}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
            >
              <option value="pt-BR">PT-BR</option>
              <option value="zh-CN">中文</option>
            </select>
          </div>
        </header>

        <nav className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <SecaoBotao atual={secaoAtual} alvo="home" onClick={setSecaoAtual}>{t('home')}</SecaoBotao>
            <SecaoBotao atual={secaoAtual} alvo="notas" onClick={setSecaoAtual}>{t('invoice')}</SecaoBotao>
            <SecaoBotao atual={secaoAtual} alvo="relatorios" onClick={setSecaoAtual}>{t('reports')}</SecaoBotao>
            <SecaoBotao atual={secaoAtual} alvo="ie-fornecedor" onClick={setSecaoAtual}>IE Fornecedor</SecaoBotao>
            <SecaoBotao atual={secaoAtual} alvo="empresas" onClick={setSecaoAtual}>{t('companies')}</SecaoBotao>
            {podeAdministrar && <SecaoBotao atual={secaoAtual} alvo="usuarios" onClick={() => abrirUsuariosAdmin()}>{t('users')}</SecaoBotao>}
            {podeAdministrar && <SecaoBotao atual={secaoAtual} alvo="configuracao" onClick={setSecaoAtual}>{t('settings')}</SecaoBotao>}
          </div>
        </nav>

        {/* Início */}
        {secaoAtual === 'home' && (
          <section className="home-shell space-y-4">
            <div className="home-hero overflow-hidden rounded-2xl px-5 py-6 text-white shadow-sm md:px-7 md:py-7">
              <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="mb-3 inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">Visão operacional</div>
                  <h2 className="max-w-2xl text-2xl font-black tracking-tight md:text-3xl">Olá, {usuario.nome.split(' ')[0]}. Aqui está o resumo de hoje.</h2>
                  <p className="mt-2 text-sm text-white/65">
                    {resumoOperacionalHome.ultimaSincronizacao ? `Última sincronização em ${dataHora(resumoOperacionalHome.ultimaSincronizacao)}` : 'Nenhuma sincronização registrada até agora.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSecaoAtual('notas')} className="rounded-lg bg-white px-4 py-2.5 text-sm font-bold text-[#211d16] hover:bg-[#f5f1e9]">Ver notas fiscais</button>
                  <button type="button" onClick={() => handleRotinaMatinal(false)} disabled={pending || sitramConsultandoTudo || rotinaMatinalRodando} className="rounded-lg border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-50">
                    {rotinaMatinalRodando || sitramConsultandoTudo ? t('updating') : 'Atualizar dados'}
                  </button>
                </div>
              </div>
            </div>

            <form
              onSubmit={(evento) => {
                evento.preventDefault();
                void buscarGlobalHome();
              }}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:p-5"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="busca-global-home" className="block text-sm font-bold text-[var(--ink)]">Busca rápida</label>
                  <p className="mt-1 text-xs text-[var(--ink-mut)]">Número da NF, chave, fornecedor, destinatário ou CNPJ.</p>
                  <input
                    id="busca-global-home"
                    value={buscaGlobalHome}
                    onChange={(evento) => setBuscaGlobalHome(evento.target.value)}
                    placeholder="Digite o que precisa encontrar..."
                    className="mt-3 h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
                  />
                </div>
                <button type="submit" disabled={buscandoGlobalHome} className="h-10 rounded-lg bg-[var(--accent)] px-5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50">
                  {buscandoGlobalHome ? 'Buscando...' : 'Buscar nota'}
                </button>
              </div>
              {resultadosBuscaHome.length > 0 && (
                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                  <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-bold text-[var(--ink)]">
                    {resultadosBuscaHome.length} resultado(s) encontrado(s). Mostrando os primeiros 10.
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {resultadosBuscaHome.map((nota) => (
                      <button key={nota.id} type="button" onClick={() => abrirResultadoBuscaHome(nota)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[var(--surface-2)]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-[var(--ink)]">NF {numeroNotaSistema(nota) || '—'} · {nota.emitenteNome || 'Emitente não informado'}</span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--ink-mut)]">{nota.cnpj.razaoSocial || formatarCnpj(nota.cnpj.cnpj)} · {data(nota.emitidaEm)}</span>
                        </span>
                        <span className="text-sm font-black text-[var(--ink)]">{moeda(nota.valorTotal)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {buscaGlobalHome.trim() && !buscandoGlobalHome && resultadosBuscaHome.length === 0 && (
                <p className="mt-3 text-sm text-[var(--ink-mut)]">Nenhuma nota encontrada para essa busca.</p>
              )}
            </form>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <HomeKpi sigla="NF" label="Notas na base" value={String(resumoInicio.totalNotas)} sub={`${resumoInicio.emitidasHoje} hoje · ${resumoInicio.emitidasUltimos7Dias} nos últimos 7 dias`} tone="dark" />
              <HomeKpi sigla="R$" label="Valor movimentado" value={moeda(resumoInicio.valorTotal)} sub="Soma das notas completas" tone="green" />
              <HomeKpi sigla="OK" label="XML completos" value={String(resumoInicio.notasCompletas)} sub={`${resumoInicio.totalNotas ? Math.round((resumoInicio.notasCompletas / resumoInicio.totalNotas) * 100) : 0}% da base disponível`} tone="blue" />
              <HomeKpi sigla="!" label="A manifestar" value={String(resumoInicio.pendentesManifestacao)} sub="Resumos aguardando ciência" tone={resumoInicio.pendentesManifestacao > 0 ? 'amber' : 'green'} />
            </div>

            {alertasCertificado.length > 0 && (
              <button type="button" onClick={() => setSecaoAtual(podeAdministrar ? 'configuracao' : 'empresas')} className={`w-full rounded-xl border px-4 py-3 text-left text-sm ${alertasCertificado.some((item) => item.dias < 0) ? 'border-red-300 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">{alertasCertificado.some((item) => item.dias < 0) ? t('certificateExpired') : t('certificateExpiring')}</div>
                    <div className="mt-1 text-xs opacity-80">{alertasCertificado.map(({ cnpj, dias }) => `${cnpj.razaoSocial || formatarCnpj(cnpj.cnpj)}: ${dias < 0 ? t('expiredDays', { days: Math.abs(dias) }) : dias === 0 ? t('expiresToday') : t('expiresInDays', { days: dias })}`).join(' · ')}</div>
                  </div>
                  <span className="shrink-0 font-bold">Revisar →</span>
                </div>
              </button>
            )}

            {(saudeSincronizacao.nivel !== 'OK' || saudeSincronizacao.worker.ultimoFimEm) && (
              <div className={`rounded-xl border px-4 py-3 text-sm ${saudeSincronizacao.nivel === 'CRITICO' ? 'border-red-300 bg-red-50 text-red-900' : saudeSincronizacao.nivel === 'ATENCAO' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-bold">
                      {saudeSincronizacao.worker.atrasado
                        ? 'Worker SEFAZ sem execução recente'
                        : saudeSincronizacao.cnpjsAtrasados.length > 0
                          ? `${saudeSincronizacao.cnpjsAtrasados.length} empresa(s) sem atualização recente`
                          : 'Sincronização SEFAZ funcionando'}
                    </div>
                    <div className="mt-1 text-xs opacity-80">
                      {saudeSincronizacao.worker.ultimoFimEm
                        ? `Último ciclo: ${dataHora(saudeSincronizacao.worker.ultimoFimEm)}`
                        : 'Nenhum ciclo do worker registrado ainda.'}
                      {saudeSincronizacao.cnpjsAtrasados.length > 0
                        ? ` · ${saudeSincronizacao.cnpjsAtrasados.slice(0, 4).map((item) => item.razaoSocial || formatarCnpj(item.cnpj)).join(', ')}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {podeAdministrar && (
                      <button
                        type="button"
                        onClick={handleConferirNotasRecentes}
                        disabled={conferindoChaves || pending}
                        className="rounded-lg border border-current px-3 py-1.5 text-xs font-bold disabled:opacity-50"
                      >
                        {conferindoChaves ? 'Conferindo...' : 'Conferir chaves recentes'}
                      </button>
                    )}
                    <button type="button" onClick={() => setSecaoAtual('empresas')} className="rounded-lg border border-current px-3 py-1.5 text-xs font-bold">
                      Ver empresas
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[1.05fr_1.4fr]">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div><h3 className="text-base font-black text-[var(--ink)]">Pontos de atenção</h3><p className="mt-1 text-xs text-[var(--ink-mut)]">O que merece revisão primeiro.</p></div>
                  <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--ink-mut)]">Agora</span>
                </div>
                <div className="space-y-2">
                  <HomePendencia titulo="Manifestações pendentes" detalhe="Resumos sem ciência da operação" valor={resumoInicio.pendentesManifestacao} tone="amber" onClick={() => setSecaoAtual('notas')} />
                  <HomePendencia titulo="XML completo pendente" detalhe="Notas que ainda estão apenas como resumo" valor={Math.max(0, resumoInicio.totalNotas - resumoInicio.notasCompletas)} tone="amber" onClick={() => abrirFilaNotasHome({ status: 'RESUMO' })} />
                  <HomePendencia titulo="DAE em aberto ou a gerar" detalhe="Notas consultadas no SITRAM" valor={resumoOperacionalHome.daeAbertos} tone="red" onClick={() => setSecaoAtual('notas')} />
                  <HomePendencia titulo="DAE vencido" detalhe="Lançamentos ainda sem pagamento" valor={resumoOperacionalHome.daeVencidos} tone="red" onClick={() => setSecaoAtual('notas')} />
                  <HomePendencia titulo="SITRAM sem consulta" detalhe="Notas que ainda precisam de atualização fiscal" valor={resumoInicio.notasSemSitram} tone="gray" onClick={() => abrirFilaNotasHome({ daeSitram: 'sem-consulta' })} />
                  <HomePendencia titulo="Empresas com atenção" detalhe="Sem busca recente ou temporariamente bloqueadas" valor={resumoOperacionalHome.empresasComAtencao} tone="gray" onClick={() => setSecaoAtual('empresas')} />
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
                <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
                  <div><h3 className="text-base font-black text-[var(--ink)]">Notas recentes</h3><p className="mt-1 text-xs text-[var(--ink-mut)]">Últimos documentos recebidos na SEFAZ.</p></div>
                  <button type="button" onClick={() => setSecaoAtual('notas')} className="text-xs font-bold text-[var(--ink)] hover:opacity-60">Ver todas →</button>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {notasRecentesHome.map((nota) => (
                    <button key={nota.id} type="button" onClick={() => setSecaoAtual('notas')} className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-5 py-3 text-left hover:bg-[var(--surface-2)] md:grid-cols-[1.4fr_.8fr_auto]">
                      <div className="min-w-0"><div className="truncate text-sm font-bold text-[var(--ink)]">{nota.emitenteNome || 'Emitente não informado'}</div><div className="mt-0.5 text-[11px] text-[var(--ink-mut)]">NF {numeroNotaSistema(nota) || '—'} · {nomeEmpresaCurta(nota)}</div></div>
                      <div className="hidden text-xs text-[var(--ink-mut)] md:block">{data(nota.emitidaEm)}</div>
                      <div className="text-right"><div className="text-sm font-black text-[var(--ink)]">{moeda(nota.valorTotal)}</div><div className={`mt-0.5 text-[10px] font-bold uppercase ${nota.status === 'COMPLETA' ? 'text-emerald-700' : 'text-amber-700'}`}>{nota.status === 'COMPLETA' ? 'Completa' : 'Resumo'}</div></div>
                    </button>
                  ))}
                  {notasRecentesHome.length === 0 && <div className="px-5 py-10 text-center text-sm text-[var(--ink-mut)]">Nenhuma nota encontrada.</div>}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <HomeAtalho sigla="NF" titulo={t('invoice')} detalhe="Consulte, filtre, manifeste e abra DANFEs." onClick={() => setSecaoAtual('notas')} />
              <HomeAtalho sigla="BI" titulo={t('reports')} detalhe="Acompanhe valores, estados e riscos fiscais." onClick={() => setSecaoAtual('relatorios')} />
              <HomeAtalho sigla="CNPJ" titulo={t('companies')} detalhe={`${resumoOperacionalHome.empresasAtivas} ativas de ${cnpjs.length} cadastradas.`} onClick={() => setSecaoAtual('empresas')} />
            </div>
          </section>
        )}

        {secaoAtual === 'relatorios' && (
          <RelatoriosDashboard
            notas={notasRelatorio}
            carregando={carregandoRelatorio}
            total={totalRelatorio}
            temMais={temMaisRelatorio}
            onCarregarMais={carregarMaisRelatorio}
          />
        )}

        {secaoAtual === 'ie-fornecedor' && <FornecedorIeConsulta />}

        {podeAdministrar && secaoAtual === 'configuracao' && (
          <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="mb-4 border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-bold text-[var(--ink)]">{t('settings')}</h2>
              <p className="text-xs text-[var(--ink-mut)]">{idioma === 'zh-CN' ? '数字证书、Windows 读取和 SEFAZ 验证。' : 'Certificado digital, leitura do Windows e verificação da SEFAZ.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setMostrarUploadCert((v) => !v)}
                disabled={pending}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:bg-amber-400 disabled:opacity-50"
              >
                {mostrarUploadCert ? t('closeCertificate') : t('updateCertificate')}
              </button>
              <button
                onClick={abrirCertificados}
                disabled={carregandoCerts}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                {carregandoCerts ? t('reading') : certs ? t('closeCertificates') : t('pcCertificates')}
              </button>
              <button
                onClick={() => executar(verificarCertificado)}
                disabled={pending}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-ink)] hover:brightness-150 disabled:opacity-50"
              >
                {t('checkCertificate')}
              </button>
            </div>
          </div>
        )}

        {podeAdministrar && secaoAtual === 'configuracao' && (
          <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border)] pb-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-base font-bold text-[var(--ink)]">API para terceiros</h2>
                <p className="mt-1 text-xs text-[var(--ink-mut)]">
                  Consulta NF, status, XML, ICMS e DAE por chave de acesso.
                </p>
              </div>
              {apiOrigem && (
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`${apiOrigem}/api-docs`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                  >
                    Documentacao
                  </a>
                  <button
                    type="button"
                    onClick={() => copiarTexto(`${apiOrigem}/api/v1/notas/{chave}`)}
                    className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                  >
                    Copiar link base
                  </button>
                </div>
              )}
            </div>

            <form action={handleGerarApiKey} className="grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                name="nome"
                placeholder="Nome da integração. Ex: Sistema financeiro"
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder-[var(--ink-mut)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
              />
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-[var(--accent-ink)] hover:brightness-150 disabled:opacity-50"
              >
                Gerar chave
              </button>
            </form>

            {apiTokenGerado && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-black">Chave criada. Copie agora.</p>
                    <p className="mt-1 break-all font-mono text-xs">{apiTokenGerado}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copiarTexto(apiTokenGerado)}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800"
                  >
                    Copiar chave
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">Consulta JSON</p>
                <code className="mt-2 block break-all text-xs text-[var(--ink)]">
                  GET {apiOrigem || 'https://seu-dominio.com'}/api/v1/notas/CHAVE_NFE
                </code>
                <p className="mt-2 text-xs text-[var(--ink-mut)]">Use `?xml=1` se quiser o XML junto no JSON.</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">XML direto</p>
                <code className="mt-2 block break-all text-xs text-[var(--ink)]">
                  GET {apiOrigem || 'https://seu-dominio.com'}/api/v1/notas/CHAVE_NFE/xml
                </code>
                <p className="mt-2 text-xs text-[var(--ink-mut)]">Autentique com `Authorization: Bearer SUA_CHAVE` ou `x-api-key`.</p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-mut)]">
                  <tr>
                    <th className="px-3 py-2 font-bold">Nome</th>
                    <th className="px-3 py-2 font-bold">Prefixo</th>
                    <th className="px-3 py-2 font-bold">Criada</th>
                    <th className="px-3 py-2 font-bold">Ultimo uso</th>
                    <th className="px-3 py-2 font-bold">Status</th>
                    <th className="px-3 py-2 font-bold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {apiKeys.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-[var(--ink-mut)]">Nenhuma chave criada.</td>
                    </tr>
                  ) : apiKeys.map((key) => (
                    <tr key={key.id} className="hover:bg-[var(--surface-2)]">
                      <td className="px-3 py-2 font-semibold text-[var(--ink)]">{key.nome}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--ink-mut)]">{key.prefixo}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-mut)]">{data(key.createdAt)}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ink-mut)]">{key.ultimoUsoEm ? dataHora(key.ultimoUsoEm) : 'Nunca'}</td>
                      <td className="px-3 py-2"><Badge tone={key.ativo ? 'green' : 'gray'}>{key.ativo ? 'ATIVA' : 'REVOGADA'}</Badge></td>
                      <td className="px-3 py-2 text-right">
                        {key.ativo && (
                          <button
                            type="button"
                            onClick={() => handleRevogarApiKey(key.id)}
                            disabled={pending}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Revogar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {podeAdministrar && secaoAtual === 'configuracao' && mostrarUploadCert && (
          <form action={handleEnviarCertificado} className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-semibold text-[var(--ink)]">{t('updateCertificateVps')}</h2>
            </div>
            <div className="grid md:grid-cols-4 gap-3">
              <input
                name="certificado"
                type="file"
                accept=".pfx"
                required
                className="md:col-span-2 border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-2)] file:px-3 file:py-1.5 file:text-sm file:font-medium"
              />
              <input
                name="senha"
                type="password"
                placeholder={t('pfxPassword')}
                required
                className="border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
              />
              <select
                name="escopo"
                defaultValue="raiz"
                className="border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
              >
                <option value="raiz">Mesma raiz</option>
                <option value="cnpj">CNPJ exato</option>
                <option value="padrao">Padrao geral</option>
              </select>
              <input
                name="alvo"
                placeholder="Raiz/CNPJ opcional"
                inputMode="numeric"
                className="md:col-span-3 border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
              />
              <button
                type="submit"
                disabled={pending}
                className="bg-amber-500 hover:bg-amber-400 text-amber-950 px-5 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
              >
                {pending ? 'Enviando...' : 'Enviar e atualizar'}
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-mut)]">
              Em "Mesma raiz", deixe o campo vazio para usar a raiz do proprio certificado.
            </p>
          </form>
        )}

        {podeAdministrar && secaoAtual === 'usuarios' && mostrarUsuarios && (
          <UsuariosAdminPainel
            cnpjs={cnpjs}
            usuarios={usuariosAdmin ?? []}
            carregando={carregandoUsuarios}
            usuarioEditando={usuarioEditando}
            onEditar={setUsuarioEditando}
            onNovo={() => setUsuarioEditando(null)}
            action={handleSalvarUsuario}
          />
        )}

        {secaoAtual === 'notas' && mostrarPagamento && (
          <ImportarPagamentoSitram
            onFechar={() => setMostrarPagamento(false)}
            onAplicado={() => { setTodasCarregadas(false); router.refresh(); }}
          />
        )}

        {/* Painel de importação por chave */}
        {secaoAtual === 'notas' && mostrarImport && (
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-semibold text-[var(--ink)]">📥 Importar notas por chave de acesso</h2>
            </div>
            <p className="text-sm text-[var(--ink-mut)] mb-3">
              Cole as chaves de acesso (44 dígitos) — pode colar a coluna inteira do Excel. O app
              busca cada nota na SEFAZ pela chave (consulta direta, sem depender do NSU).
            </p>
            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <select
                value={importCnpjId}
                onChange={(e) => setImportCnpjId(e.target.value ? Number(e.target.value) : '')}
                className="border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
              >
                <option value="">Empresa destinatária das notas…</option>
                {cnpjs.map((c) => (
                  <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-[var(--ink-mut)]">
                <input
                  type="checkbox"
                  checked={importManifestar}
                  onChange={(e) => setImportManifestar(e.target.checked)}
                  className="w-4 h-4"
                />
                Manifestar (Ciência) para baixar o XML completo
              </label>
            </div>
            <textarea
              value={importTexto}
              onChange={(e) => setImportTexto(e.target.value)}
              placeholder="Cole aqui as chaves de acesso (uma por linha ou coladas do Excel)…"
              rows={5}
              className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleImportar}
                disabled={!!importProgresso && importProgresso.feito < importProgresso.total}
                className="bg-[var(--accent)] hover:bg-[var(--accent)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {importProgresso && importProgresso.feito < importProgresso.total
                  ? `Importando… ${importProgresso.feito}/${importProgresso.total}`
                  : 'Importar'}
              </button>
              <span className="text-xs text-[var(--ink-mut)]">
                {[...new Set(importTexto.match(/\d{44}/g) ?? [])].length} chave(s) detectada(s)
              </span>
            </div>

            {importProgresso && (
              <div className="mt-3">
                <div className="w-full bg-[var(--surface-2)] rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-[var(--accent)] h-2 transition-all"
                    style={{ width: `${(importProgresso.feito / importProgresso.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {importResumo && (
              <div className="flex flex-wrap gap-2 mt-3 text-xs">
                {importResumo['completa'] ? <Badge tone="green">{importResumo['completa']} completa(s)</Badge> : null}
                {importResumo['manifestada'] ? <Badge tone="amber">{importResumo['manifestada']} manifestada(s)</Badge> : null}
                {importResumo['resumo'] ? <Badge tone="blue">{importResumo['resumo']} resumo(s)</Badge> : null}
                {importResumo['ja-tinha'] ? <Badge tone="gray">{importResumo['ja-tinha']} já tinha</Badge> : null}
                {importResumo['fora-de-prazo'] ? <Badge tone="orange">{importResumo['fora-de-prazo']} fora de prazo (&gt;90d)</Badge> : null}
                {importResumo['nao-encontrada'] ? <Badge tone="orange">{importResumo['nao-encontrada']} não encontrada(s)</Badge> : null}
                {importResumo['erro'] ? <Badge tone="orange">{importResumo['erro']} erro(s)</Badge> : null}
              </div>
            )}

            {/* Importar arquivos XML de uma pasta (notas antigas, do contador/ERP) */}
            {podeAdministrar && (
            <div className="mt-5 pt-4 border-t border-[var(--border)]">
              <p className="text-sm font-medium text-[var(--ink)] mb-1">
                Importar XMLs de uma pasta <span className="text-[var(--ink-mut)] font-normal">(notas antigas / do contador — sem SEFAZ, qualquer data)</span>
              </p>
              <div className="flex gap-2">
                <input
                  value={pastaXml}
                  onChange={(e) => setPastaXml(e.target.value)}
                  placeholder="Ex.: C:\Users\diarl\Documents\XMLs-Contador"
                  className="flex-1 border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                />
                <button
                  onClick={handleImportarPasta}
                  disabled={pending || !pastaXml}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Importar pasta
                </button>
              </div>
              <p className="text-xs text-[var(--ink-mut)] mt-1">
                Cada XML é associado à empresa (emitente ou destinatário) já cadastrada. Funciona para qualquer ano.
              </p>
            </div>
            )}
          </div>
        )}

        {secaoAtual === 'notas' && mostrarSitram && (
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-semibold text-[var(--ink)]">SITRAM por NF-e ou MDF-e</h2>
            </div>
            <p className="text-sm text-[var(--ink-mut)] mb-3">
              Cole chave(s) de NF-e modelo 55 para consultar direto. Chave de MDF-e modelo 58 tambem funciona pelo manifesto.
            </p>
            <textarea
              value={sitramTexto}
              onChange={(e) => setSitramTexto(e.target.value)}
              placeholder="Cole aqui uma ou mais chaves de NF-e ou MDF-e..."
              rows={4}
              className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleSitram}
                disabled={pending}
                className="bg-[var(--accent)] hover:bg-[var(--accent)] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {pending ? 'Consultando...' : 'Consultar SITRAM'}
              </button>
              <span className="text-xs text-[var(--ink-mut)]">
                {[...new Set(sitramTexto.match(/\d{44}/g) ?? [])].length} chave(s) detectada(s)
              </span>
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--border)] grid md:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <p className="text-sm font-medium text-[var(--ink)]">Atualizar SITRAM do ano</p>
                <p className="text-xs text-[var(--ink-mut)]">
                  Reconsulta NF-e fora do CE que ainda nao tem SITRAM ou foi consultada antes de hoje. Usa a empresa selecionada acima, se houver.
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <label className="text-xs text-[var(--ink-mut)]">
                    Ano
                    <select
                      value={sitramAno}
                      onChange={(e) => setSitramAno(e.target.value)}
                      disabled={sitramConsultandoTudo}
                      className="ml-2 border border-[var(--border-strong)] rounded-lg px-3 py-1 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none disabled:opacity-50"
                    >
                      {anosDisponiveis.map((ano) => (
                        <option key={ano} value={String(ano)}>{ano}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSitramAtualizacaoDiaria}
                  disabled={pending || sitramConsultandoTudo || !sitramAno}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {sitramConsultandoTudo && sitramProgresso
                    ? `Consultando ${sitramProgresso.feito}/${sitramProgresso.total}`
                    : sitramConsultandoTudo
                      ? 'Buscando atualizacoes...'
                      : 'Atualizar SITRAM'}
                </button>
                <button
                  onClick={handleAtualizarTransporte}
                  disabled={pending}
                  className="border border-[var(--border-strong)] text-[var(--ink-mut)] hover:bg-[var(--surface-2)] px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Atualizar transportadoras
                </button>
              </div>
            </div>
            {sitramProgresso && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--ink-mut)]">
                  <span>{sitramProgresso.feito} de {sitramProgresso.total} consultada(s)</span>
                  <span>{sitramProgresso.atualizadas} atualizada(s) • {sitramProgresso.erros} erro(s)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${sitramProgresso.total ? (sitramProgresso.feito / sitramProgresso.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-[var(--ink-mut)]">A consulta continua sozinha até terminar o ano. Os últimos 100 resultados aparecem abaixo.</p>
              </div>
            )}
            {sitramResultados && (
              <div className="mt-3 space-y-1 text-xs">
                {sitramResultados.map((r) => (
                  <div
                    key={r.chave}
                    className={r.status === 'erro' ? 'text-red-700' : 'text-[var(--ink-mut)]'}
                  >
                    <span className="font-mono">{r.chave.slice(0, 8)}...{r.chave.slice(-6)}</span>
                    {' - '}
                    {r.status === 'erro'
                      ? r.detalhe
                      : `${r.notasAtualizadas} registro(s) atualizado(s)${r.detalhe ? ` - ${r.detalhe}` : ''}`}
                    {r.notasNaoEncontradas ? `, ${r.notasNaoEncontradas} nao atualizada(s)` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Painel de certificados */}
        {podeAdministrar && secaoAtual === 'configuracao' && certs && (
          <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-semibold text-[var(--ink)]">🔐 Certificados Digitais no Windows</h2>
              <button
                onClick={handleVincularCerts}
                disabled={pending}
                className="bg-[var(--accent)] hover:bg-[var(--accent)] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Cadastrar / vincular todas
              </button>
            </div>
            {certs.length === 0 ? (
              <p className="text-sm text-[var(--ink-mut)] py-2">Nenhum e-CNPJ encontrado no repositório do Windows.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-[var(--ink-mut)] text-xs uppercase tracking-wide border-b border-[var(--border)]">
                      <th className="pb-2 font-medium">Empresa</th>
                      <th className="pb-2 font-medium">CNPJ</th>
                      <th className="pb-2 font-medium">UF</th>
                      <th className="pb-2 font-medium">Validade</th>
                      <th className="pb-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {certs.map((c) => (
                      <tr key={c.thumbprint} className="hover:bg-[var(--surface-2)]">
                        <td className="py-2.5 font-medium text-[var(--ink)]">{c.razaoSocial}</td>
                        <td className="py-2.5 font-mono text-xs text-[var(--ink-mut)]">{formatarCnpj(c.cnpj)}</td>
                        <td className="py-2.5">{c.uf}</td>
                        <td className={`py-2.5 ${c.vencido ? 'text-red-600 font-medium' : 'text-[var(--ink-mut)]'}`}>
                          {new Date(c.vencimento).toLocaleDateString('pt-BR')}
                          {c.vencido ? ' (vencido)' : ''}
                        </td>
                        <td className="py-2.5">
                          <Badge tone={c.jaCadastrado ? 'green' : 'amber'}>
                            {c.jaCadastrado ? 'CADASTRADA' : 'NOVA'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-[var(--ink-mut)] mt-3">
              Para sincronizar/manifestar, cada empresa precisa do arquivo .pfx (a chave no Windows não é
              exportável). Empresas da mesma raiz compartilham o mesmo .pfx.
            </p>
          </div>
        )}

        {/* Status */}
        <div
          className={`mb-6 px-4 py-3 rounded-xl border text-sm flex items-center gap-2 ${
            status.success === true
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : status.success === false
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--ink-mut)]'
          }`}
        >
          <span>
            {pending ? '⏳' : status.success === true ? '✅' : status.success === false ? '⚠️' : 'ℹ️'}
          </span>
          <span>{pending ? 'Processando…' : status.message}</span>
        </div>

        {(secaoAtual === 'empresas' || secaoAtual === 'notas') && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Empresas */}
          <div className={`${secaoAtual === 'empresas' ? 'lg:col-span-4' : 'hidden'} bg-[var(--surface)] p-4 rounded-xl shadow-sm border border-[var(--border)]`}>
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--ink)]">{t('companies')}</h2>
                <p className="text-xs text-[var(--ink-mut)]">{cnpjs.length} {t('registered')}</p>
              </div>
              {podeAdministrar && !mostrarForm && (
                <button
                  onClick={() => setMostrarForm(true)}
                  className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                >
                  {t('add')}
                </button>
              )}
            </div>

            {cnpjs.length === 0 && !mostrarForm && (
              <p className="text-sm text-[var(--ink-mut)] py-2">{t('noCnpj')}</p>
            )}

            <ul className="space-y-2">
              {cnpjs.map((c) => {
                const bloqueado = c.bloqueadoAte ? new Date(c.bloqueadoAte) > new Date() : false;
                const hora = c.bloqueadoAte
                  ? new Date(c.bloqueadoAte).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'America/Sao_Paulo',
                    })
                  : '';
                const consumoIndevido = /consumo indevido/i.test(c.situacao);
                const situacaoCurta = bloqueado
                  ? t('waitSefazUntil', { time: hora })
                  : consumoIndevido
                    ? t('sefazLimit')
                    : c.situacao;
                return (
                  <li key={c.id} className="rounded-lg border border-[var(--border)] p-3 hover:bg-[var(--surface-2)]/60 transition">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight text-[var(--ink)] truncate" title={c.razaoSocial || t('noName')}>{c.razaoSocial || t('noName')}</p>
                        <p className="text-xs text-[var(--ink-mut)] font-mono">{formatarCnpj(c.cnpj)}</p>
                        <p className="text-[11px] text-[var(--ink-mut)] mt-1 rounded-md bg-[var(--surface-2)] px-2 py-1">
                          {c.uf} · NSU {Number(c.ultimoNSU)} · {c._count.notas} nota(s)
                        </p>
                      </div>
                      <Badge tone={c.ativo ? 'green' : 'gray'}>{c.ativo ? t('active') : t('inactive')}</Badge>
                    </div>
                    <p className={`mt-2 text-[11px] font-medium ${bloqueado || consumoIndevido ? 'text-amber-700' : 'text-[var(--ink-mut)]'}`} title={c.situacao}>
                      {situacaoCurta}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      <button
                        onClick={() => executar(() => sincronizarNotas(c.id))}
                        disabled={pending || !c.ativo || bloqueado}
                        title={bloqueado ? t('waitSefazUntil', { time: hora }) : t('syncWithSefaz')}
                        className="rounded-md bg-emerald-600 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:bg-[var(--surface-2)] disabled:text-[var(--ink-mut)]"
                      >
                        {bloqueado ? t('until', { time: hora }) : t('sync')}
                      </button>
                      {podeAdministrar && (
                        <>
                          <button
                            onClick={() => executar(() => alternarAtivoCnpj(c.id))}
                            disabled={pending}
                            className="rounded-md border border-[var(--border)] px-2.5 py-1.5 font-medium text-[var(--ink-mut)] hover:bg-[var(--surface-2)] disabled:opacity-40"
                          >
                            {c.ativo ? t('disable') : t('enable')}
                          </button>
                          <button
                            onClick={() => executar(() => removerCnpj(c.id))}
                            disabled={pending}
                            className="rounded-md border border-red-200 px-2.5 py-1.5 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            {t('remove')}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {podeAdministrar && (mostrarForm ? (
              <form action={handleAdicionarCnpj} className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
                <input name="cnpj" placeholder={t('cnpjOnlyNumbers')} required
                  className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] focus:border-[var(--accent)] outline-none" />
                <input name="razaoSocial" placeholder={t('companyNameOptional')}
                  className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] focus:border-[var(--accent)] outline-none" />
                <input name="uf" placeholder={t('ufExample')} required maxLength={2}
                  className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm uppercase bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] focus:border-[var(--accent)] outline-none" />
                <div className="flex gap-2">
                  <button type="submit" disabled={pending}
                    className="flex-1 bg-[var(--accent)] hover:bg-[var(--accent)] text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                    {t('save')}
                  </button>
                  <button type="button" onClick={() => setMostrarForm(false)}
                    className="flex-1 bg-[var(--surface-2)] hover:bg-[var(--surface-2)] text-[var(--ink)] py-2 rounded-lg text-sm font-medium">
                    {t('cancel')}
                  </button>
                </div>
              </form>
            ) : null)}
          </div>

          {/* Notas */}
          <div className={`${secaoAtual === 'notas' ? 'lg:col-span-4' : 'hidden'} bg-[var(--surface)] p-5 rounded-2xl shadow-sm border border-[var(--border)]`}>
            <AlertaDaes
              notas={notasAlerta}
              cnpjId={filtroCnpjId}
              onFiltrar={filtrarVencimentoDae}
            />
            <section className="mb-5 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 text-slate-900 shadow-sm">
              <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMostrarFiltros((valor) => !valor)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-800 hover:bg-slate-200"
                    aria-label={mostrarFiltros ? 'Recolher filtros' : 'Expandir filtros'}
                  >
                    {mostrarFiltros ? 'Ocultar filtros' : 'Mostrar filtros'}
                  </button>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Filtros de notas fiscais</h2>
                    <p className="text-xs text-slate-600">Combine os critérios e clique em Pesquisar.</p>
                  </div>
                  {mostrarFiltros && (
                    <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white text-sm font-semibold">
                      <button
                        type="button"
                        onClick={() => setModoFiltroNotas('resumido')}
                        aria-pressed={modoFiltroNotas === 'resumido'}
                        className={`px-3 py-1.5 transition ${modoFiltroNotas === 'resumido' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        Resumido
                      </button>
                      <button
                        type="button"
                        onClick={() => setModoFiltroNotas('avancado')}
                        aria-pressed={modoFiltroNotas === 'avancado'}
                        className={`px-3 py-1.5 transition ${modoFiltroNotas === 'avancado' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                      >
                        Avançado
                      </button>
                    </div>
                  )}
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                  {carregandoTodas && <span className="mr-2 text-[11px] font-semibold text-amber-700">Carregando base...</span>}
                  {filtrosPendentes && !carregandoTodas && <span className="mr-2 text-[11px] font-semibold text-amber-700">Alteracoes pendentes</span>}
                  <button
                    type="button"
                    onClick={() => void aplicarFiltrosNotas()}
                    disabled={carregandoTodas || carregandoAno}
                    className="h-9 rounded-lg border border-slate-400 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-200 disabled:opacity-50"
                  >
                    Pesquisar
                  </button>
                  <button
                    type="button"
                    onClick={limparFiltrosAvancados}
                    disabled={filtrosAtivos === 0 && filtrosAplicadosAtivos === 0}
                    className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                  >
                    Limpar filtros
                  </button>
                  <button
                    type="button"
                    onClick={filtrarErroImportacaoNotas}
                    disabled={carregandoTodas}
                    className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    Erro de Importacao
                  </button>
                  <button
                    type="button"
                    onClick={filtrarXmlCompletoNotas}
                    disabled={carregandoTodas}
                    className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    XML
                  </button>
                  <button
                    type="button"
                    onClick={abrirInclusaoNotas}
                    className="h-9 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-700"
                  >
                    Incluir
                  </button>
                </div>
              </div>

              {mostrarFiltros && (
                <div className="space-y-4 bg-slate-50 p-4 sm:p-5">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-slate-900">Dados principais</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Localize a nota por loja, pessoa, status ou período.</p>
                    </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-4 lg:grid-cols-12">
                    <CampoFiltroNotas label="Loja" className="lg:col-span-4">
                      <select
                        value={filtroCnpjId}
                        onChange={(e) => setFiltroCnpjId(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
                        className={CAMPO_FILTRO_NOTAS}
                      >
                        <option value="todos">Todas as lojas</option>
                        {cnpjs.map((c) => (
                          <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                        ))}
                      </select>
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Status XML" className="lg:col-span-2">
                      <select
                        value={filtroStatus}
                        onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                        className={CAMPO_FILTRO_NOTAS}
                      >
                        <option value="todos">Todos</option>
                        <option value="RESUMO">Resumo</option>
                        <option value="COMPLETA">Completa</option>
                      </select>
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Emissao - inicio" className="lg:col-span-3">
                      <input type="date" value={filtroDataInicio} onChange={(e) => setFiltroDataInicio(e.target.value)} className={CAMPO_FILTRO_NOTAS} />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Emissao - fim" className="lg:col-span-3">
                      <input type="date" value={filtroDataFim} onChange={(e) => setFiltroDataFim(e.target.value)} className={CAMPO_FILTRO_NOTAS} />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Fornecedor" className="lg:col-span-4">
                      <CampoBuscaOpcoesFiltro
                        valor={filtroEmitente}
                        opcoes={sugestoesEmitente}
                        placeholder="Todos os fornecedores"
                        onChange={setFiltroEmitente}
                      />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Num. Documento" className="lg:col-span-2">
                      <input
                        value={filtroNumero}
                        onChange={(e) => setFiltroNumero(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void aplicarFiltrosNotas();
                          }
                        }}
                        inputMode="numeric"
                        className={CAMPO_FILTRO_NOTAS}
                      />
                    </CampoFiltroNotas>
                  </div>
                  </div>

                  {modoFiltroNotas === 'avancado' && (
                  <>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-slate-900">Mais critérios</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Destinatário, datas de entrada, chave e valores.</p>
                    </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-4 lg:grid-cols-12">
                    <CampoFiltroNotas label="Destinatario" className="lg:col-span-2">
                      <CampoBuscaOpcoesFiltro
                        valor={filtroDestinatario}
                        opcoes={sugestoesDestinatario}
                        placeholder="Todos os destinatarios"
                        onChange={setFiltroDestinatario}
                      />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Entrada - inicio" className="lg:col-span-3">
                      <input type="date" value={filtroDataEntradaInicio} onChange={(e) => setFiltroDataEntradaInicio(e.target.value)} className={CAMPO_FILTRO_NOTAS} />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Entrada - fim" className="lg:col-span-3">
                      <input type="date" value={filtroDataEntradaFim} onChange={(e) => setFiltroDataEntradaFim(e.target.value)} className={CAMPO_FILTRO_NOTAS} />
                    </CampoFiltroNotas>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-4 lg:grid-cols-12">
                    <CampoFiltroNotas label="Chave NF-e" className="lg:col-span-4">
                      <input
                        value={filtroChave}
                        onChange={(e) => setFiltroChave(e.target.value)}
                        inputMode="numeric"
                        maxLength={44}
                        className={CAMPO_FILTRO_NOTAS}
                      />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Serie" className="lg:col-span-2">
                      <input value={filtroSerie} onChange={(e) => setFiltroSerie(e.target.value)} inputMode="numeric" className={CAMPO_FILTRO_NOTAS} />
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Valor NF" className="lg:col-span-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="number" value={filtroValorMin} onChange={(e) => setFiltroValorMin(e.target.value)} placeholder="Min." className={CAMPO_FILTRO_NOTAS} />
                        <input type="number" value={filtroValorMax} onChange={(e) => setFiltroValorMax(e.target.value)} placeholder="Max." className={CAMPO_FILTRO_NOTAS} />
                      </div>
                    </CampoFiltroNotas>
                    <CampoFiltroNotas label="Qtd. Itens" className="lg:col-span-2">
                      <div className="grid grid-cols-2 gap-1.5">
                        <input type="number" min={0} value={filtroItensMin} onChange={(e) => setFiltroItensMin(e.target.value)} placeholder="Min." className={CAMPO_FILTRO_NOTAS} />
                        <input type="number" min={0} value={filtroItensMax} onChange={(e) => setFiltroItensMax(e.target.value)} placeholder="Max." className={CAMPO_FILTRO_NOTAS} />
                      </div>
                    </CampoFiltroNotas>
                  </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-slate-900">Classificacao da nota</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Use mais de uma opcao quando precisar cruzar situacoes.</p>
                    </div>
                  <div className="grid gap-5 lg:grid-cols-4">
                    <GrupoCheckboxFiltro titulo="Situacoes" opcoes={SITUACOES_NOTA_OPCOES} selecionados={filtroSituacoes} onToggle={toggleFiltroSituacaoNota} />
                    <GrupoCheckboxFiltro titulo="Origem" opcoes={ORIGEM_NOTA_OPCOES} selecionados={filtroOrigens} onToggle={toggleFiltroOrigemNota} />
                    <GrupoCheckboxFiltro titulo="Manifesto" opcoes={MANIFESTO_NOTA_OPCOES} selecionados={filtroManifestos} onToggle={toggleFiltroManifestoNota} />
                    <GrupoCheckboxFiltro titulo="Modalidades" opcoes={MODALIDADE_NOTA_OPCOES} selecionados={filtroModalidades} onToggle={toggleFiltroModalidadeNota} />
                  </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-4">
                      <h3 className="text-sm font-bold text-slate-900">SITRAM, DAE e etiquetas</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Refine por situacao fiscal, vencimento ou organizacao interna.</p>
                    </div>
                  <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr_1.35fr]">
                    <GrupoCheckboxFiltro
                      titulo="SITRAM / DAE"
                      opcoes={[
                        { valor: 'consultado', label: 'Consultado' },
                        { valor: 'sem-consulta', label: 'Sem consulta' },
                        { valor: 'com-dae', label: 'Com DAE' },
                        { valor: 'a-pagar', label: 'A pagar' },
                        { valor: 'em-aberto', label: 'Em aberto' },
                        { valor: 'pago', label: 'Pago' },
                        { valor: 'duplicidade', label: 'Duplicidade' },
                        { valor: 'sem-dae', label: 'Sem DAE' },
                        { valor: 'nao-encontrada', label: 'Nao encontrada' },
                      ]}
                      selecionados={filtroDaeSitram === 'todos' ? [] : [filtroDaeSitram]}
                      onToggle={(valor) => setFiltroDaeSitram(filtroDaeSitram === valor ? 'todos' : valor as FiltroDaeSitram)}
                    />
                    <div className="space-y-2">
                      <CampoFiltroNotas label="Situacao SITRAM">
                        <CampoBuscaOpcoesFiltro
                          valor={filtroSituacaoSitram}
                          opcoes={situacoesSitramParaFiltro}
                          placeholder="Todas as situacoes SITRAM"
                          onChange={setFiltroSituacaoSitram}
                        />
                      </CampoFiltroNotas>
                      <CampoFiltroNotas label="Vencimento do DAE">
                        <div className="grid grid-cols-2 gap-1.5">
                          <input type="date" aria-label="Vencimento DAE - inicio" value={filtroDaeVencInicio} onChange={(e) => setFiltroDaeVencInicio(e.target.value)} className={CAMPO_FILTRO_NOTAS} />
                          <input type="date" aria-label="Vencimento DAE - fim" value={filtroDaeVencFim} onChange={(e) => setFiltroDaeVencFim(e.target.value)} className={CAMPO_FILTRO_NOTAS} />
                        </div>
                      </CampoFiltroNotas>
                      <label className="flex items-center gap-2 text-sm font-semibold leading-5 text-slate-800">
                        <input type="checkbox" checked={filtroForaCe15SemDae} onChange={() => alternarFiltroForaCe15SemDae()} className="h-4 w-4" />
                        Fora do CE +15 dias ({qtdForaCe15SemDae})
                      </label>
                    </div>
                    <div className="space-y-2">
                      <GrupoCheckboxFiltro
                        titulo="Etiquetas"
                        opcoes={[
                          { valor: 'sem-etiqueta', label: 'Sem etiqueta' },
                          ...etiquetasParaFiltro.map((tag) => ({ valor: tag, label: tag })),
                        ]}
                        selecionados={filtroEtiquetas}
                        onToggle={toggleFiltroEtiqueta}
                      />
                      <CampoFiltroNotas label="Excluir fornecedor">
                        <div className="flex gap-1.5">
                          <div className="min-w-0 flex-1">
                            <CampoBuscaOpcoesFiltro
                              valor={excluirEmitenteInput}
                              opcoes={sugestoesEmitente}
                              placeholder="Selecione fornecedor"
                              onChange={setExcluirEmitenteInput}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={adicionarExclusaoEmitente}
                            disabled={!excluirEmitenteInput.trim()}
                            className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        </div>
                      </CampoFiltroNotas>
                      {filtroExcluirEmitentes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {filtroExcluirEmitentes.map((ex) => (
                            <button
                              key={ex}
                              type="button"
                              onClick={() => removerExclusaoEmitente(ex)}
                              className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                              title="Remover"
                            >
                              {ex} x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  </div>
                  </>
                  )}
                </div>
              )}
            </section>
            <div className="hidden">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-base font-semibold text-[var(--ink)]">{t('invoices')}</h2>
                <div className="relative flex-1 min-w-[220px]">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-mut)] text-sm">🔎</span>
                  <input
                    value={filtroNumero}
                    onChange={(e) => setFiltroNumero(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void aplicarFiltrosNotas();
                      }
                    }}
                    inputMode="numeric"
                    placeholder={t('searchInvoice')}
                    className="w-full border border-[var(--border-strong)] rounded-lg pl-9 pr-8 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] focus:border-[var(--accent)] outline-none"
                  />
                  {filtroNumero && (
                    <button
                      type="button"
                      onClick={() => setFiltroNumero('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink-mut)] hover:text-[var(--ink)] text-sm"
                      aria-label={t('clearSearch')}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void aplicarFiltrosNotas()}
                  disabled={carregandoTodas}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
                >
                  {carregandoTodas ? 'Carregando...' : filtrosPendentes ? 'Aplicar busca' : 'Buscar'}
                </button>
                <select
                  value={filtroCnpjId}
                  onChange={(e) => setFiltroCnpjId(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
                  className="border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                >
                  <option value="todos">{t('allCompanies')}</option>
                  {cnpjs.map((c) => (
                    <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                  ))}
                </select>
                <select
                  value={filtroStatus}
                  onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                  className="border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                >
                  <option value="todos">{t('allStatuses')}</option>
                  <option value="RESUMO">{t('summary')}</option>
                  <option value="COMPLETA">{t('complete')}</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setFiltroForaCe15SemDae(false);
                    setFiltroDaeSitram((v) => (v === 'a-pagar' ? 'todos' : 'a-pagar'));
                  }}
                  title={t('daePayFilter')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                    filtroDaeSitram === 'a-pagar'
                      ? 'text-white'
                      : 'bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  }`}
                  style={filtroDaeSitram === 'a-pagar'
                    ? { background: 'var(--warn)', borderColor: 'var(--warn)' }
                    : { color: 'var(--warn)', borderColor: 'color-mix(in srgb, var(--warn) 40%, var(--border))' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: filtroDaeSitram === 'a-pagar' ? '#fff' : 'var(--warn)' }} />
                  {t('daeToPay')}
                </button>
                <button
                  onClick={alternarFiltroForaCe15SemDae}
                  title="Notas completas de emitentes fora do CE, emitidas há mais de 15 dias, sem DAE gerado e sem ICMS pago"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                    filtroForaCe15SemDae ? 'text-white' : 'bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  }`}
                  style={filtroForaCe15SemDae
                    ? { background: 'var(--crit)', borderColor: 'var(--crit)' }
                    : { color: 'var(--crit)', borderColor: 'color-mix(in srgb, var(--crit) 40%, var(--border))' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: filtroForaCe15SemDae ? '#fff' : 'var(--crit)' }} />
                  Fora do CE +15 dias · {qtdForaCe15SemDae}
                </button>
                <button
                  onClick={() => setMostrarFiltros((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition ${
                    mostrarFiltros || filtrosAtivos > 0 || filtrosAplicadosAtivos > 0
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-ink)]'
                      : 'border-[var(--border-strong)] text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  Filtros{filtrosAplicadosAtivos > 0 ? ` · ${filtrosAplicadosAtivos}` : filtrosAtivos > 0 ? ` · ${filtrosAtivos}` : ''}
                  {filtrosPendentes ? ' *' : ''}
                </button>
                {(algumFiltroAtivo || mostrarFiltros || filtrosPendentes) && (
                  <button
                    onClick={limparFiltrosAvancados}
                    className="px-3 py-1.5 rounded-full text-sm font-medium text-[var(--ink-mut)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition"
                  >
                    Limpar tudo
                  </button>
                )}
                {carregandoTodas && (
                  <span className="text-xs text-[var(--ink-mut)]">carregando todas as notas…</span>
                )}
                {filtrosPendentes && !carregandoTodas && (
                  <span className="text-xs font-medium text-amber-700">alterações pendentes: clique em Aplicar busca</span>
                )}
              </div>
            </div>

            {false && mostrarFiltros && (
              <div className="mb-4 p-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Emitente (nome ou CNPJ)</label>
                  <input
                    value={filtroEmitente}
                    onChange={(e) => setFiltroEmitente(e.target.value)}
                    placeholder="Buscar emitente…"
                    list="sugestoes-emitente"
                    className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                  />
                  <datalist id="sugestoes-emitente">
                    {sugestoesEmitente.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Destinatário (nome ou CNPJ)</label>
                  <input
                    value={filtroDestinatario}
                    onChange={(e) => setFiltroDestinatario(e.target.value)}
                    placeholder="Buscar destinatário…"
                    list="sugestoes-destinatario"
                    className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                  />
                  <datalist id="sugestoes-destinatario">
                    {sugestoesDestinatario.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Etiqueta</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleFiltroEtiqueta('sem-etiqueta')}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                        filtroEtiquetas.includes('sem-etiqueta')
                          ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                          : 'bg-[var(--surface)] border-[var(--border-strong)] text-[var(--ink-mut)] hover:border-[var(--border-strong)] hover:bg-[var(--accent-soft)]'
                      }`}
                    >
                      Sem etiqueta
                    </button>
                    {etiquetasParaFiltro.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleFiltroEtiqueta(tag)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                          filtroEtiquetas.includes(tag)
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                            : 'bg-[var(--surface)] border-[var(--border-strong)] text-[var(--ink-mut)] hover:border-[var(--border-strong)] hover:bg-[var(--accent-soft)]'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Valor da NF (R$)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={filtroValorMin}
                      onChange={(e) => setFiltroValorMin(e.target.value)}
                      placeholder="Mín."
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                    <input
                      type="number"
                      value={filtroValorMax}
                      onChange={(e) => setFiltroValorMax(e.target.value)}
                      placeholder="Máx."
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Qtd. de itens</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      value={filtroItensMin}
                      onChange={(e) => setFiltroItensMin(e.target.value)}
                      placeholder="Mín."
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      value={filtroItensMax}
                      onChange={(e) => setFiltroItensMax(e.target.value)}
                      placeholder="Máx."
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--ink-mut)] mt-1">Disponível apenas para notas COMPLETA.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Data de emissão (intervalo)</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={filtroDataInicio}
                      onChange={(e) => setFiltroDataInicio(e.target.value)}
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                    <input
                      type="date"
                      value={filtroDataFim}
                      onChange={(e) => setFiltroDataFim(e.target.value)}
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Mês / Ano</label>
                  <div className="flex gap-2">
                    <select
                      value={filtroMes}
                      onChange={(e) => setFiltroMes(e.target.value)}
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    >
                      <option value="">Todos os meses</option>
                      {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) => (
                        <option key={i + 1} value={String(i + 1)}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={filtroAno}
                      onChange={(e) => setFiltroAnoState(e.target.value)}
                      disabled={carregandoAno}
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none disabled:opacity-60"
                    >
                      <option value="">Todos (base completa)</option>
                      {anosDisponiveis.map((ano) => (
                        <option key={ano} value={String(ano)}>{ano}{anoCarregado === ano ? ' ✓' : ''}</option>
                      ))}
                    </select>
                    {carregandoAno && <p className="text-xs text-[var(--accent)] mt-1">Carregando notas de {filtroAno}…</p>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Situação SEFAZ</label>
                  <select
                    value={filtroSituacao}
                    onChange={(e) => setFiltroSituacao(e.target.value as typeof filtroSituacao)}
                    className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                  >
                    <option value="todas">Todas</option>
                    <option value="AUTORIZADA">Autorizada</option>
                    <option value="CANCELADA">Cancelada</option>
                    <option value="DENEGADA">Denegada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">DAE SITRAM</label>
                  <select
                    value={filtroDaeSitram}
                    onChange={(e) => setFiltroDaeSitram(e.target.value as FiltroDaeSitram)}
                    className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                  >
                    <option value="todos">Todos</option>
                    <option value="consultado">Consultado</option>
                    <option value="com-dae">Com DAE</option>
                    <option value="a-pagar">{t('daePayFilter')}</option>
                    <option value="em-aberto">Em aberto</option>
                    <option value="pago">Pago</option>
                    <option value="duplicidade">Suspeita duplicidade</option>
                    <option value="sem-dae">Sem DAE</option>
                    <option value="nao-encontrada">Nao encontrada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Vencimento do DAE (intervalo)</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={filtroDaeVencInicio}
                      onChange={(e) => setFiltroDaeVencInicio(e.target.value)}
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                    <input
                      type="date"
                      value={filtroDaeVencFim}
                      onChange={(e) => setFiltroDaeVencFim(e.target.value)}
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-[var(--ink-mut)] mb-1">Excluir emitente (nome ou CNPJ)</label>
                  <div className="flex gap-2">
                    <input
                      value={excluirEmitenteInput}
                      onChange={(e) => setExcluirEmitenteInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          adicionarExclusaoEmitente();
                        }
                      }}
                      placeholder="Não mostrar notas deste emitente…"
                      list="sugestoes-emitente"
                      className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-sm bg-[var(--surface)] text-[var(--ink)] placeholder-[var(--ink-mut)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={adicionarExclusaoEmitente}
                      disabled={!excluirEmitenteInput.trim()}
                      className="shrink-0 border border-[var(--border-strong)] text-[var(--ink-mut)] text-sm font-medium hover:bg-[var(--surface-2)] rounded-lg px-3 py-1.5 transition disabled:opacity-40"
                    >
                      Excluir
                    </button>
                  </div>
                  {filtroExcluirEmitentes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {filtroExcluirEmitentes.map((ex) => (
                        <span
                          key={ex}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 border border-rose-200 text-rose-700"
                        >
                          {ex}
                          <button
                            type="button"
                            onClick={() => removerExclusaoEmitente(ex)}
                            className="text-rose-500 hover:text-rose-800"
                            aria-label={`Remover exclusão de ${ex}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-end gap-2 lg:col-span-3">
                  <button
                    type="button"
                    onClick={() => void aplicarFiltrosNotas()}
                    disabled={carregandoTodas || carregandoAno}
                    className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
                  >
                    {carregandoTodas || carregandoAno ? 'Carregando...' : 'Aplicar busca/filtros'}
                  </button>
                  <button
                    type="button"
                    onClick={limparFiltrosAvancados}
                    disabled={filtrosAtivos === 0 && filtrosAplicadosAtivos === 0 && !filtroNumero.trim()}
                    className="flex-1 border border-dashed border-[var(--border-strong)] text-[var(--ink-mut)] text-sm font-medium hover:bg-[var(--surface-2)] hover:border-slate-400 rounded-lg py-2 transition disabled:opacity-40"
                  >
                    Limpar filtros
                  </button>
                </div>
              </div>
            )}

            {!anoCarregado && totalNotas > notas.length && (
              <div className="mb-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
                <span>⚠️</span>
                <span>
                  Exibindo <strong>{notas.length} notas</strong> de <strong>{totalNotas} no total</strong>.
                  A base completa esta carregando em segundo plano para busca, filtros e totais.
                </span>
                <button
                  onClick={() => { setMostrarFiltros(true); void carregarTodasNotasEmSegundoPlano(); }}
                  className="ml-auto shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1 rounded-lg"
                >
                  Abrir filtros
                </button>
              </div>
            )}

            <div id="lista-notas-resultados" className="flex scroll-mt-4 justify-between text-sm text-[var(--ink-mut)] mb-2 px-1">
              <span>
                {notasFiltradas.length} nota(s)
                {anoCarregado ? ` de ${anoCarregado}` : ''}
                {filtrosPendentes ? ' - aguardando aplicar' : ''}
              </span>
              <span>Total: <strong className="text-[var(--ink)]">{moeda(totalFiltrado)}</strong></span>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
              <section className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-bold text-sky-900">Consulta pagamento ICMS em lote</p>
                  </div>
                  <Badge tone={notasPagamentoIcmsElegiveis.length > 0 ? 'sky' : 'gray'}>
                    {notasPagamentoIcmsElegiveis.length} visiveis para consultar
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setPainelPagamentoLoteAberto((valor) => !valor)}
                    className="grid h-7 w-7 place-items-center rounded-md border border-sky-300 bg-white text-sm font-black text-sky-800 hover:bg-sky-100"
                    title={painelPagamentoLoteAberto ? 'Minimizar' : 'Maximizar'}
                    aria-label={painelPagamentoLoteAberto ? 'Minimizar consulta pagamento ICMS' : 'Maximizar consulta pagamento ICMS'}
                  >
                    {painelPagamentoLoteAberto ? '-' : '+'}
                  </button>
                </div>
                {painelPagamentoLoteAberto && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="min-w-[220px] flex-1 text-xs text-sky-700">
                      Consulta NF com DAE no SITRAM. DAE pago antigo consulta uma vez e fica gravado; DAE aberto pode reconsultar.
                    </p>
                    <button
                      onClick={handleConsultarPagamentoIcmsLote}
                      disabled={consultandoPagamentoLote || pending}
                      className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                      {consultandoPagamentoLote ? 'Consultando...' : 'Consultar pagamento em lote'}
                    </button>
                    {pagamentoLoteResultado && (
                      <div className="w-full flex flex-wrap gap-2 text-xs">
                        <Badge tone="blue">{pagamentoLoteResultado.processadas} processada(s)</Badge>
                        <Badge tone="green">{pagamentoLoteResultado.pagas} paga(s)</Badge>
                        <Badge tone="orange">{pagamentoLoteResultado.emAberto} em aberto</Badge>
                        {(pagamentoLoteResultado.notasComSuspeitaDuplicidade ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setFiltroDaeSitram('duplicidade');
                              setMostrarFiltros(true);
                              setPaginaCliente(1);
                            }}
                            className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold tracking-wide text-red-700 hover:bg-red-200"
                          >
                            Ver {pagamentoLoteResultado.notasComSuspeitaDuplicidade} suspeita(s) duplicidade
                          </button>
                        )}
                        {pagamentoLoteResultado.erros > 0 && <Badge tone="red">{pagamentoLoteResultado.erros} erro(s)</Badge>}
                        {pagamentoLoteResultado.limiteAplicado && <Badge tone="amber">limite aplicado</Badge>}
                      </div>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex min-w-[210px] items-center gap-2 text-sm font-semibold text-indigo-900">
                    <input
                      type="checkbox"
                      checked={todasVisiveisSelecionadas}
                      onChange={toggleSelecionarVisiveis}
                      disabled={notasVisiveis.length === 0}
                      className="h-4 w-4"
                    />
                    Selecionar visiveis ({notasVisiveis.length})
                  </label>
                  <div className="flex min-w-[240px] flex-1 flex-wrap gap-1.5">
                    {ETIQUETAS_PRESET.map((tag) => {
                      const ativa = etiquetasLote.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleEtiquetaLote(tag)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition ${
                            ativa
                              ? 'border-indigo-700 bg-indigo-700 text-white'
                              : 'border-indigo-200 bg-white text-indigo-800 hover:bg-indigo-100'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={handleAplicarEtiquetasLote}
                    disabled={selecionadas.size === 0 || etiquetasLote.length === 0 || aplicandoEtiquetasLote}
                    className="rounded-lg bg-indigo-700 px-4 py-1.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-50"
                  >
                    {aplicandoEtiquetasLote ? 'Aplicando...' : `Aplicar etiquetas (${selecionadas.size})`}
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[220px] flex-1">
                    <p className="text-sm font-bold text-amber-900">Manifestacao em lote</p>
                  </div>
                  <Badge tone={notasManifestaveis.length > 0 ? 'amber' : 'gray'}>
                    {notasManifestaveis.length} pendente(s)
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setPainelManifestoLoteAberto((valor) => !valor)}
                    className="grid h-7 w-7 place-items-center rounded-md border border-amber-300 bg-white text-sm font-black text-amber-800 hover:bg-amber-100"
                    title={painelManifestoLoteAberto ? 'Minimizar' : 'Maximizar'}
                    aria-label={painelManifestoLoteAberto ? 'Minimizar manifestacao em lote' : 'Maximizar manifestacao em lote'}
                  >
                    {painelManifestoLoteAberto ? '-' : '+'}
                  </button>
                </div>
                {painelManifestoLoteAberto && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex min-w-[220px] flex-1 items-center gap-2 text-sm text-amber-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={todasSelecionadas}
                        onChange={toggleSelecionarTodas}
                        disabled={notasManifestaveis.length === 0}
                        className="w-4 h-4"
                      />
                      Selecionar todas pendentes de manifestacao ({notasManifestaveis.length})
                    </label>
                    <button
                      onClick={handleManifestarLote}
                      disabled={selecionadasManifestaveisQtd === 0 || (!!manifestoLoteProgresso && manifestoLoteProgresso.feito < manifestoLoteProgresso.total)}
                      className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {manifestoLoteProgresso && manifestoLoteProgresso.feito < manifestoLoteProgresso.total
                    ? `Manifestando... ${manifestoLoteProgresso?.feito ?? 0}/${manifestoLoteProgresso?.total ?? 0}`
                        : `Manifestar selecionadas (${selecionadasManifestaveisQtd})`}
                    </button>
                    {manifestoLoteTemResumo && (
                      <div className="flex w-full flex-col gap-2">
                        <div className="flex flex-wrap gap-2 text-xs">
                          {manifestoLoteResumo['manifestada'] ? <Badge tone="green">{manifestoLoteResumo['manifestada']} manifestada(s)</Badge> : null}
                          {manifestoLoteResumo['ja-manifestada'] ? <Badge tone="gray">{manifestoLoteResumo['ja-manifestada']} ja manifestada(s)</Badge> : null}
                          {manifestoLoteResumo['completa'] ? <Badge tone="blue">{manifestoLoteResumo['completa']} ja completa(s)</Badge> : null}
                          {manifestoLoteResumo['erro'] ? <Badge tone="orange">{manifestoLoteResumo['erro']} erro(s)</Badge> : null}
                        </div>
                        {manifestoLoteErrosLista.length > 0 && (
                          <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                            <p className="font-semibold text-red-700 mb-1">Detalhes dos erros:</p>
                            {manifestoLoteErrosLista.map((e, i) => (
                              <div key={i} className="text-red-600">
                                <span className="font-mono text-red-400">{e.chave.slice(0, 8)}...{e.chave.slice(-6)}</span>
                                {' - '}{e.detalhe}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>

            <div className="hidden">
              <div className="min-w-[240px] flex-1">
                <p className="text-sm font-bold text-sky-900">Consulta pagamento ICMS em lote</p>
                <p className="text-xs text-sky-700">
                  Consulta NF com DAE no SITRAM. DAE pago antigo consulta uma vez e fica gravado; DAE aberto pode reconsultar.
                </p>
              </div>
              <Badge tone={notasPagamentoIcmsElegiveis.length > 0 ? 'sky' : 'gray'}>
                {notasPagamentoIcmsElegiveis.length} visiveis para consultar
              </Badge>
              <button
                onClick={handleConsultarPagamentoIcmsLote}
                disabled={consultandoPagamentoLote || pending}
                className="bg-sky-600 hover:bg-sky-700 text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
              >
                {consultandoPagamentoLote ? 'Consultando...' : 'Consultar pagamento em lote'}
              </button>
              {pagamentoLoteResultado && (
                <div className="w-full flex flex-wrap gap-2 text-xs">
                  <Badge tone="blue">{pagamentoLoteResultado.processadas} processada(s)</Badge>
                  <Badge tone="green">{pagamentoLoteResultado.pagas} paga(s)</Badge>
                  <Badge tone="orange">{pagamentoLoteResultado.emAberto} em aberto</Badge>
                  {(pagamentoLoteResultado.notasComSuspeitaDuplicidade ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setFiltroDaeSitram('duplicidade');
                        setMostrarFiltros(true);
                        setPaginaCliente(1);
                      }}
                      className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold tracking-wide text-red-700 hover:bg-red-200"
                    >
                      Ver {pagamentoLoteResultado.notasComSuspeitaDuplicidade} suspeita(s) duplicidade
                    </button>
                  )}
                  {pagamentoLoteResultado.erros > 0 && <Badge tone="red">{pagamentoLoteResultado.erros} erro(s)</Badge>}
                  {pagamentoLoteResultado.limiteAplicado && <Badge tone="amber">limite aplicado</Badge>}
                </div>
              )}
            </div>

            {false && notasManifestaveis.length > 0 && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-amber-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={todasSelecionadas}
                    onChange={toggleSelecionarTodas}
                    className="w-4 h-4"
                  />
                  Selecionar todas pendentes de manifestação ({notasManifestaveis.length})
                </label>
                <button
                  onClick={handleManifestarLote}
                  disabled={selecionadas.size === 0 || ((manifestoLoteProgresso?.feito ?? 0) < (manifestoLoteProgresso?.total ?? 0))}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {(manifestoLoteProgresso?.feito ?? 0) < (manifestoLoteProgresso?.total ?? 0)
                    ? `Manifestando... ${manifestoLoteProgresso?.feito ?? 0}/${manifestoLoteProgresso?.total ?? 0}`
                    : `Manifestar selecionadas (${selecionadas.size})`}
                </button>
                {manifestoLoteTemResumo && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {manifestoLoteResumo['manifestada'] ? <Badge tone="green">{manifestoLoteResumo['manifestada']} manifestada(s)</Badge> : null}
                      {manifestoLoteResumo['ja-manifestada'] ? <Badge tone="gray">{manifestoLoteResumo['ja-manifestada']} já manifestada(s)</Badge> : null}
                      {manifestoLoteResumo['completa'] ? <Badge tone="blue">{manifestoLoteResumo['completa']} já completa(s)</Badge> : null}
                      {manifestoLoteResumo['erro'] ? <Badge tone="orange">{manifestoLoteResumo['erro']} erro(s)</Badge> : null}
                    </div>
                    {manifestoLoteErrosLista.length > 0 && (
                      <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                        <p className="font-semibold text-red-700 mb-1">Detalhes dos erros:</p>
                        {manifestoLoteErrosLista.map((e, i) => (
                          <div key={i} className="text-red-600">
                            <span className="font-mono text-red-400">{e.chave.slice(0, 8)}…{e.chave.slice(-6)}</span>
                            {' — '}{e.detalhe}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[56px]" />
                  <col style={{ width: `${largurasColunas.nf}px` }} />
                  <col style={{ width: `${largurasColunas.emitente}px` }} />
                  <col style={{ width: `${largurasColunas.destinatario}px` }} />
                  <col style={{ width: `${largurasColunas.valores}px` }} />
                  <col style={{ width: `${largurasColunas.transporte}px` }} />
                  <col style={{ width: `${largurasColunas.sitram}px` }} />
                  <col style={{ width: `${largurasColunas.status}px` }} />
                </colgroup>
                <thead>
                  <tr className="bg-[var(--surface-2)] text-[var(--ink-mut)] text-xs uppercase tracking-wide border-b border-[var(--border)]">
                    <th className="px-3 py-2 font-medium"></th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>NF</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('nf', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>Emitente</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('emitente', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>Destinatário</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('destinatario', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>Valores</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('valores', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>Transporte</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('transporte', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>SITRAM / DAE</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('sitram', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <div className="relative flex items-center justify-center">
                        <span>Status</span>
                        <span onMouseDown={(event) => iniciarResizeColuna('status', event)} className="absolute right-[-10px] top-[-8px] h-8 w-5 cursor-col-resize" />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {notasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-[var(--ink-mut)]">
                        Nenhuma nota para o filtro selecionado.
                      </td>
                    </tr>
                  )}
                  {notasVisiveis.map((n) => (
                    <CompactFragmentNota
                      key={n.id}
                      nota={n}
                      aberta={expandida === n.id}
                      onToggle={() => setExpandida(expandida === n.id ? null : n.id)}
                      selecionavel={true}
                      selecionada={selecionadas.has(n.id)}
                      onToggleSelecionada={() => toggleSelecionada(n.id)}
                      onNotaAtualizada={atualizarNotaLocal}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--ink-mut)]">
              <span>
                Mostrando {notasFiltradas.length === 0 ? 0 : semPaginacaoCliente ? 1 : (paginaClienteSegura - 1) * porPagina + 1}
                {' '}a {semPaginacaoCliente ? notasFiltradas.length : Math.min(paginaClienteSegura * porPagina, notasFiltradas.length)} de {notasFiltradas.length}
              </span>
              {usandoPaginacaoServidor ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(paginaAtual <= 2 ? '/' : `/?page=${paginaAtual - 1}`)}
                    disabled={paginaAtual <= 1}
                    className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    Página {paginaAtual} de {totalPaginasServidor}
                  </span>
                  <button
                    onClick={() => router.push(`/?page=${paginaAtual + 1}`)}
                    disabled={paginaAtual >= totalPaginasServidor}
                    className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              ) : totalPaginasCliente > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPaginaCliente((p) => Math.max(1, p - 1))}
                    disabled={paginaClienteSegura <= 1}
                    className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    Página {paginaClienteSegura} de {totalPaginasCliente}
                  </span>
                  <button
                    onClick={() => setPaginaCliente((p) => Math.min(totalPaginasCliente, p + 1))}
                    disabled={paginaClienteSegura >= totalPaginasCliente}
                    className="rounded-lg border border-[var(--border-strong)] px-3 py-1.5 text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        )}

        <p className="text-center text-xs text-[var(--ink-mut)] mt-8">
          Danfe Collect - Gestao digital de documentos fiscais
        </p>
      </div>
    </div>
  );
}

function SecaoBotao({
  atual,
  alvo,
  onClick,
  children,
}: {
  atual: SecaoApp;
  alvo: SecaoApp;
  onClick: (alvo: SecaoApp) => void;
  children: React.ReactNode;
}) {
  const ativo = atual === alvo;
  return (
    <button
      type="button"
      onClick={() => onClick(alvo)}
      className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
        ativo
          ? 'bg-[var(--accent)] text-white shadow-sm'
          : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-mut)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
      }`}
    >
      {children}
    </button>
  );
}

function HomeKpi({ sigla, label, value, sub, tone }: { sigla: string; label: string; value: string; sub: string; tone: 'dark' | 'green' | 'blue' | 'amber' }) {
  const tones = {
    dark: 'bg-[#211d16] text-white',
    green: 'bg-emerald-100 text-emerald-800',
    blue: 'bg-sky-100 text-sky-800',
    amber: 'bg-amber-100 text-amber-800',
  };
  return (
    <div className="home-kpi rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm md:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--ink-mut)]">{label}</p>
        <span className={`grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-[10px] font-black ${tones[tone]}`}>{sigla}</span>
      </div>
      <p className="mt-3 truncate text-xl font-black tracking-tight text-[var(--ink)] md:text-2xl" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      <p className="mt-1 truncate text-[11px] text-[var(--ink-mut)] md:text-xs">{sub}</p>
    </div>
  );
}

function HomePendencia({ titulo, detalhe, valor, tone, onClick }: { titulo: string; detalhe: string; valor: number; tone: 'amber' | 'red' | 'gray'; onClick: () => void }) {
  const tones = {
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-[var(--surface-2)] text-[var(--ink)]',
  };
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-transparent p-2.5 text-left hover:border-[var(--border)] hover:bg-[var(--surface-2)]">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-black ${tones[tone]}`}>{valor}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-[var(--ink)]">{titulo}</span><span className="block truncate text-[11px] text-[var(--ink-mut)]">{detalhe}</span></span>
      <span className="text-sm text-[var(--ink-mut)]">→</span>
    </button>
  );
}

function HomeAtalho({ sigla, titulo, detalhe, onClick }: { sigla: string; titulo: string; detalhe: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md"
    >
      <span className="grid h-11 min-w-11 place-items-center rounded-xl bg-[var(--accent-soft)] px-2 text-[10px] font-black text-[var(--accent)]">{sigla}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-black text-[var(--ink)]">{titulo}</span><span className="mt-1 block truncate text-xs text-[var(--ink-mut)]">{detalhe}</span></span>
      <span className="text-[var(--ink-mut)] transition group-hover:translate-x-1">→</span>
    </button>
  );
}

function alternarValorFiltro(atuais: string[], valor: string): string[] {
  return atuais.includes(valor) ? atuais.filter((item) => item !== valor) : [...atuais, valor];
}

function ChecklistFiltro({
  titulo,
  opcoes,
  selecionados,
  onToggle,
  onMarcarTodos,
  onLimpar,
  extra,
  className = '',
  maxHeight = 'max-h-36',
}: {
  titulo: string;
  opcoes: Array<{ valor: string; label: string; sub?: string }>;
  selecionados: string[];
  onToggle: (valor: string) => void;
  onMarcarTodos?: () => void;
  onLimpar?: () => void;
  extra?: React.ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const marcados = new Set(selecionados);
  const totalSelecionado = selecionados.length;
  const resumo = totalSelecionado === 0
    ? 'Nenhum'
    : totalSelecionado === opcoes.length
      ? 'Todos'
      : `${totalSelecionado} marcados`;

  useEffect(() => {
    if (!aberto) return;

    function fecharFora(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setAberto(false);
    }

    function fecharEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') setAberto(false);
    }

    document.addEventListener('mousedown', fecharFora);
    document.addEventListener('keydown', fecharEsc);
    return () => {
      document.removeEventListener('mousedown', fecharFora);
      document.removeEventListener('keydown', fecharEsc);
    };
  }, [aberto]);

  return (
    <div ref={ref} className={`relative min-w-[150px] ${aberto ? 'z-40' : 'z-0'} ${className}`}>
      <button
        type="button"
        onClick={() => setAberto((atual) => !atual)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-left text-sm transition ${
          aberto
            ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm'
            : 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-2)]'
        }`}
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{titulo}</span>
          <span className="block truncate font-semibold">{resumo}</span>
        </span>
        <span className={`text-xs transition ${aberto ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {aberto && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[min(90vw,340px)] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{titulo}</p>
            {(onMarcarTodos || onLimpar) && (
              <div className="flex items-center gap-1">
                {onMarcarTodos && (
                  <button type="button" onClick={onMarcarTodos} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)]">
                    Todos
                  </button>
                )}
                {onLimpar && (
                  <button type="button" onClick={onLimpar} className="rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--ink-mut)] hover:bg-[var(--surface-2)]">
                    Limpar
                  </button>
                )}
              </div>
            )}
          </div>
          {extra}
          <div className={`space-y-1 overflow-y-auto pr-1 ${maxHeight}`}>
            {opcoes.map((opcao) => (
              <label key={opcao.valor} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)]">
                <input
                  type="checkbox"
                  checked={marcados.has(opcao.valor)}
                  onChange={() => onToggle(opcao.valor)}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--border-strong)] text-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold" title={opcao.label}>{opcao.label}</span>
                  {opcao.sub && <span className="block truncate text-[11px] text-[var(--ink-mut)]" title={opcao.sub}>{opcao.sub}</span>}
                </span>
              </label>
            ))}
            {opcoes.length === 0 && (
              <p className="px-2 py-2 text-xs text-[var(--ink-mut)]">Sem opcoes</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RelatoriosDashboard({
  notas,
  carregando,
  total,
  temMais,
  onCarregarMais,
}: {
  notas: NotaRelatorio[];
  carregando: boolean;
  total: number;
  temMais: boolean;
  onCarregarMais: () => void;
}) {
  const { idioma, t } = useIdioma();
  const [ufSelecionada, setUfSelecionada] = useState<string | null>(null);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [filtroRaizesEmpresaRelatorio, setFiltroRaizesEmpresaRelatorio] = useState<string[]>(RAIZES_RELATORIO_PADRAO);
  const [filtroTipoRelatorio, setFiltroTipoRelatorio] = useState('todos');
  const [filtroSituacoesRelatorio, setFiltroSituacoesRelatorio] = useState<string[]>(SITUACOES_RELATORIO_OPCOES.map((opcao) => opcao.valor));
  const [filtroDaesRelatorio, setFiltroDaesRelatorio] = useState<string[]>(DAE_RELATORIO_OPCOES.map((opcao) => opcao.valor));
  const [filtroFornecedoresRelatorio, setFiltroFornecedoresRelatorio] = useState<string[]>([]);
  const [fornecedorFiltroAtivo, setFornecedorFiltroAtivo] = useState(false);
  const [buscaFornecedorRelatorio, setBuscaFornecedorRelatorio] = useState('');
  const [filtroRiscoRelatorio, setFiltroRiscoRelatorio] = useState('todos');
  const [buscaRelatorio, setBuscaRelatorio] = useState('');
  const [limiteTabela, setLimiteTabela] = useState(20);
  const [baixandoExcelTransporte, setBaixandoExcelTransporte] = useState(false);
  const [erroExcelTransporte, setErroExcelTransporte] = useState<string | null>(null);
  const [filtrosRelatorioAplicados, setFiltrosRelatorioAplicados] = useState<FiltrosRelatorioAplicados>({
    dataInicio: '',
    dataFim: '',
    raizesEmpresa: RAIZES_RELATORIO_PADRAO,
    tipo: 'todos',
    situacoes: SITUACOES_RELATORIO_OPCOES.map((opcao) => opcao.valor),
    daes: DAE_RELATORIO_OPCOES.map((opcao) => opcao.valor),
    fornecedores: [],
    fornecedorAtivo: false,
    risco: 'todos',
    busca: '',
  });
  const inicioPeriodo = filtrosRelatorioAplicados.dataInicio && filtrosRelatorioAplicados.dataFim && filtrosRelatorioAplicados.dataInicio > filtrosRelatorioAplicados.dataFim
    ? filtrosRelatorioAplicados.dataFim
    : filtrosRelatorioAplicados.dataInicio;
  const fimPeriodo = filtrosRelatorioAplicados.dataInicio && filtrosRelatorioAplicados.dataFim && filtrosRelatorioAplicados.dataInicio > filtrosRelatorioAplicados.dataFim
    ? filtrosRelatorioAplicados.dataInicio
    : filtrosRelatorioAplicados.dataFim;

  const notasIndexadas = useMemo(() => notas.map((nota) => {
    const emitidaEmIso = nota.emitidaEm instanceof Date ? nota.emitidaEm.toISOString() : String(nota.emitidaEm);
    const dataChave = chaveDataLocal(emitidaEmIso) ?? '';
    const daeStatus = statusDaeEfetivo(nota);
    const diasDae = diasAteVencimento(nota.daeVencimento);
    const daePendente = DAE_A_PAGAR.includes(daeStatus);
    const pendencias = [
      nota.status === 'RESUMO' ? 'XML completo pendente' : null,
      !nota.manifestadaEm ? 'Sem manifestação' : null,
      !nota.sitramConsultadaEm ? 'Sem consulta SITRAM' : null,
      daePendente && diasDae !== null && diasDae < 0 ? 'DAE vencido' : null,
      daePendente && diasDae !== null && diasDae >= 0 && diasDae <= 7 ? 'DAE vence em 7 dias' : null,
      nota.situacaoSefaz === 'CANCELADA' ? 'Nota cancelada' : null,
      nota.situacaoSefaz === 'DENEGADA' ? 'Nota denegada' : null,
    ].filter(Boolean) as string[];
    const risco = daePendente && diasDae !== null && diasDae < 0
      ? 'critico'
      : nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA'
        ? 'alto'
        : pendencias.length > 0
          ? 'medio'
          : 'baixo';
    const valor = nota.valorTotal ?? 0;
    const icms = nota.valorIcms ?? 0;
    return {
      ...nota,
      dataChave,
      mesChave: dataChave.slice(0, 7),
      uf: (nota.emitenteUf || '').trim().toUpperCase(),
      daeStatus,
      diasDae,
      daePendente,
      pendencias,
      risco,
      valor,
      icms,
      impostoPago: daeStatus === 'PAGO' ? (nota.daeValorPago ?? nota.pagamentoManualValor ?? icms) : 0,
      impostoPendente: daePendente ? (nota.daeValorAberto ?? nota.daeValor ?? icms) : 0,
      empresaRaiz: raizCnpj(nota.cnpj.cnpj),
      empresaLabel: nota.cnpj.razaoSocial || formatarCnpj(nota.cnpj.cnpj),
      tipoLabel: nota.tipoOperacao || 'Entrada',
      emitenteChave: nota.emitenteCnpj || nota.emitenteNome || `nota-${nota.id}`,
      emitenteNomeRelatorio: nota.emitenteNome || nota.emitenteCnpj || 'Sem emitente',
      buscaTexto: normalizarBuscaFiltro([
        nota.numero,
        nota.serie,
        nota.chave,
        nota.emitenteNome,
        nota.emitenteCnpj,
        nota.destNome,
        nota.destCnpj,
        nota.cnpj.razaoSocial,
        nota.cnpj.cnpj,
      ].filter(Boolean).join(' ')),
    };
  }), [notas]);

  const empresasRelatorio = useMemo(() => {
    const mapa = new Map<string, { raiz: string; nome: string; sub: string; ordem: number }>();
    for (const nota of notasIndexadas) {
      const raiz = nota.empresaRaiz;
      if (!raiz) continue;
      const sub = formatarCnpj(nota.cnpj.cnpj);
      const atual = mapa.get(raiz);
      if (atual) {
        if (!atual.sub.includes(sub)) atual.sub = `${atual.sub}, ${sub}`;
        continue;
      }
      const ordem = raiz === '45998339' ? 1 : raiz === '50767035' ? 2 : raiz === '62803717' ? 3 : 9;
      mapa.set(raiz, {
        raiz,
        nome: nomeEmpresaRelatorioPorRaiz(raiz, nota.cnpj.razaoSocial || nota.empresaLabel),
        sub,
        ordem,
      });
    }
    return [...mapa.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  }, [notasIndexadas]);

  const fornecedoresRelatorio = useMemo(() => {
    const mapa = new Map<string, { valor: string; label: string; sub: string; qtd: number }>();
    for (const nota of notasIndexadas) {
      if (filtroRaizesEmpresaRelatorio.length > 0 && !filtroRaizesEmpresaRelatorio.includes(nota.empresaRaiz)) continue;
      const valor = nota.emitenteCnpj || nota.emitenteNomeRelatorio;
      const atual = mapa.get(valor);
      if (atual) {
        atual.qtd += 1;
        continue;
      }
      mapa.set(valor, {
        valor,
        label: nota.emitenteNomeRelatorio,
        sub: nota.emitenteCnpj ? formatarCnpj(nota.emitenteCnpj) : '',
        qtd: 1,
      });
    }
    return [...mapa.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((item) => ({ ...item, sub: item.sub ? `${item.sub} - ${item.qtd} NF` : `${item.qtd} NF` }));
  }, [notasIndexadas, filtroRaizesEmpresaRelatorio]);

  const fornecedoresVisiveisRelatorio = useMemo(() => {
    const busca = normalizarBuscaFiltro(buscaFornecedorRelatorio);
    const digitos = buscaFornecedorRelatorio.replace(/\D/g, '');
    if (!busca && !digitos) return fornecedoresRelatorio;
    return fornecedoresRelatorio.filter((item) => {
      const texto = normalizarBuscaFiltro(`${item.label} ${item.sub}`);
      const numeros = `${item.valor} ${item.sub}`.replace(/\D/g, '');
      return (busca.length > 0 && texto.includes(busca)) || (digitos.length > 0 && numeros.includes(digitos));
    });
  }, [fornecedoresRelatorio, buscaFornecedorRelatorio]);

  const todosFornecedoresRelatorio = useMemo(() => fornecedoresRelatorio.map((item) => item.valor), [fornecedoresRelatorio]);
  const fornecedoresSelecionadosRelatorio = fornecedorFiltroAtivo ? filtroFornecedoresRelatorio : todosFornecedoresRelatorio;
  const fornecedoresAplicadosRelatorio = filtrosRelatorioAplicados.fornecedorAtivo
    ? filtrosRelatorioAplicados.fornecedores
    : todosFornecedoresRelatorio;

  function notaPassaFiltroDaeRelatorio(nota: (typeof notasIndexadas)[number]): boolean {
    if (filtrosRelatorioAplicados.daes.length === DAE_RELATORIO_OPCOES.length) return true;
    if (filtrosRelatorioAplicados.daes.length === 0) return false;
    return filtrosRelatorioAplicados.daes.some((filtro) => {
      if (filtro === 'pago') return nota.daeStatus === 'PAGO';
      if (filtro === 'pendente') return nota.daePendente;
      if (filtro === 'vencido') return nota.daePendente && nota.diasDae !== null && nota.diasDae < 0;
      if (filtro === 'vence7') return nota.daePendente && nota.diasDae !== null && nota.diasDae >= 0 && nota.diasDae <= 7;
      if (filtro === 'sem-consulta') return !nota.sitramConsultadaEm;
      if (filtro === 'sem-dae') return nota.daeStatus === 'SEM_DAE';
      if (filtro === 'consultado') return nota.daeStatus === 'CONSULTADO';
      return false;
    });
  }

  // Notas dentro do período escolhido (filtro por data de emissão)
  const notasPeriodo = useMemo(() => {
    const busca = normalizarBuscaFiltro(filtrosRelatorioAplicados.busca);
    return notasIndexadas.filter((n) => {
      if (!n.dataChave) return false;
      if (inicioPeriodo && n.dataChave < inicioPeriodo) return false;
      if (fimPeriodo && n.dataChave > fimPeriodo) return false;
      if (filtrosRelatorioAplicados.raizesEmpresa.length === 0 || !filtrosRelatorioAplicados.raizesEmpresa.includes(n.empresaRaiz)) return false;
      if (fornecedoresAplicadosRelatorio.length === 0 || !fornecedoresAplicadosRelatorio.includes(n.emitenteCnpj || n.emitenteNomeRelatorio)) return false;
      if (filtrosRelatorioAplicados.tipo !== 'todos' && n.tipoLabel !== filtrosRelatorioAplicados.tipo) return false;
      if (filtrosRelatorioAplicados.situacoes.length === 0 || !filtrosRelatorioAplicados.situacoes.includes(n.situacaoSefaz)) return false;
      if (!notaPassaFiltroDaeRelatorio(n)) return false;
      if (filtrosRelatorioAplicados.risco !== 'todos' && n.risco !== filtrosRelatorioAplicados.risco) return false;
      if (busca && !n.buscaTexto.includes(busca)) return false;
      return true;
    });
  }, [
    notasIndexadas,
    inicioPeriodo,
    fimPeriodo,
    filtrosRelatorioAplicados,
    fornecedoresAplicadosRelatorio,
  ]);

  // Agregação por UF do emitente
  const { valores, maxValor, ranking } = useMemo(() => {
    const porUf = new Map<string, ValorUf>();
    for (const nota of notasPeriodo) {
      const uf = nota.uf;
      if (!uf || uf === 'NA' || uf.length !== 2) continue;
      const item = porUf.get(uf) ?? { qtd: 0, valor: 0 };
      item.qtd += 1;
      item.valor += nota.valor;
      porUf.set(uf, item);
    }
    const rank = [...porUf.entries()]
      .map(([uf, v]) => ({ uf, ...v }))
      .sort((a, b) => b.valor - a.valor);
    return { valores: porUf, maxValor: Math.max(...rank.map((r) => r.valor), 0), ranking: rank };
  }, [notasPeriodo]);

  // Detalhe do estado selecionado
  const detalheUf = useMemo(() => {
    if (!ufSelecionada) return null;
    const doEstado = notasPeriodo.filter((n) => n.uf === ufSelecionada);
    const valor = doEstado.reduce((a, n) => a + n.valor, 0);
    const icms = doEstado.reduce((a, n) => a + n.icms, 0);

    const porEmitente = new Map<string, { nome: string; qtd: number; valor: number; icms: number }>();
    const porMes = new Map<string, { qtd: number; valor: number }>();
    for (const n of doEstado) {
      const chaveEmit = n.emitenteCnpj || n.emitenteNome || '—';
      const emit = porEmitente.get(chaveEmit) ?? { nome: n.emitenteNome || chaveEmit, qtd: 0, valor: 0, icms: 0 };
      emit.qtd += 1;
      emit.valor += n.valor;
      emit.icms += n.icms;
      porEmitente.set(chaveEmit, emit);

      const mesChave = n.mesChave;
      const mes = porMes.get(mesChave) ?? { qtd: 0, valor: 0 };
      mes.qtd += 1;
      mes.valor += n.valor;
      porMes.set(mesChave, mes);
    }

    const topEmitentes = [...porEmitente.values()].sort((a, b) => b.valor - a.valor).slice(0, 8);
    const meses = [...porMes.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const maxMes = Math.max(...meses.map(([, v]) => v.valor), 0);
    return { qtd: doEstado.length, valor, icms, topEmitentes, meses, maxMes };
  }, [ufSelecionada, notasPeriodo]);

  const topUf = ranking[0];
  const totalValorPeriodo = ranking.reduce((a, r) => a + r.valor, 0);
  const tiposRelatorio = useMemo(() => {
    return [...new Set(notasIndexadas.map((nota) => nota.tipoLabel))].filter(Boolean).sort();
  }, [notasIndexadas]);
  const resumoFiscal = useMemo(() => {
    const porMes = new Map<string, { qtd: number; valor: number; icms: number; pago: number; pendente: number }>();
    const porEmitente = new Map<string, { nome: string; qtd: number; valor: number; icms: number }>();
    let icms = 0;
    let impostoPago = 0;
    let impostoPendente = 0;
    let semSitram = 0;
    let daePagoQtd = 0;
    let daeAbertoQtd = 0;
    let daeSemCobrancaQtd = 0;
    let canceladas = 0;
    let aguardandoConferencia = 0;
    let daeVencidoQtd = 0;
    let daeVencidoValor = 0;
    const riscos = { baixo: 0, medio: 0, alto: 0, critico: 0 };

    for (const nota of notasPeriodo) {
      icms += nota.icms;
      impostoPago += nota.impostoPago;
      impostoPendente += nota.impostoPendente;
      if (!nota.sitramConsultadaEm) semSitram++;
      if (nota.daeStatus === 'PAGO') daePagoQtd++;
      if (DAE_A_PAGAR.includes(nota.daeStatus)) daeAbertoQtd++;
      if (nota.daeStatus === 'SEM_DAE') daeSemCobrancaQtd++;
      if (nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'DENEGADA') canceladas++;
      if (nota.status === 'RESUMO') aguardandoConferencia++;
      if (nota.risco in riscos) riscos[nota.risco as keyof typeof riscos]++;
      if (nota.daePendente && nota.diasDae !== null && nota.diasDae < 0) {
        daeVencidoQtd++;
        daeVencidoValor += nota.impostoPendente;
      }

      const mes = porMes.get(nota.mesChave) ?? { qtd: 0, valor: 0, icms: 0, pago: 0, pendente: 0 };
      mes.qtd += 1;
      mes.valor += nota.valor;
      mes.icms += nota.icms;
      mes.pago += nota.impostoPago;
      mes.pendente += nota.impostoPendente;
      porMes.set(nota.mesChave, mes);

      const emit = porEmitente.get(nota.emitenteChave) ?? { nome: nota.emitenteNomeRelatorio, qtd: 0, valor: 0, icms: 0 };
      emit.qtd += 1;
      emit.valor += nota.valor;
      emit.icms += nota.icms;
      porEmitente.set(nota.emitenteChave, emit);
    }

    const meses = [...porMes.entries()].filter(([chave]) => !!chave).sort((a, b) => a[0].localeCompare(b[0]));
    const topEmitentes = [...porEmitente.values()].sort((a, b) => b.valor - a.valor).slice(0, 10);
    return {
      icms,
      impostoPago,
      impostoPendente,
      semSitram,
      daePagoQtd,
      daeAbertoQtd,
      daeSemCobrancaQtd,
      canceladas,
      aguardandoConferencia,
      daeVencidoQtd,
      daeVencidoValor,
      riscos,
      meses,
      maxMes: Math.max(...meses.map(([, v]) => v.valor), 0),
      topEmitentes,
    };
  }, [notasPeriodo]);
  const comparativoMes = useMemo(() => {
    const meses = resumoFiscal.meses;
    const atual = meses.at(-1);
    const anterior = meses.at(-2);
    const valorAtual = atual?.[1].valor ?? 0;
    const valorAnterior = anterior?.[1].valor ?? 0;
    const variacao = valorAnterior ? ((valorAtual - valorAnterior) / valorAnterior) * 100 : null;
    return {
      atual: atual?.[0] ?? null,
      anterior: anterior?.[0] ?? null,
      valorAtual,
      valorAnterior,
      variacao,
    };
  }, [resumoFiscal.meses]);
  const daesPrioritarios = useMemo(() => {
    return notasPeriodo
      .filter((nota) => nota.daePendente && nota.diasDae !== null && nota.diasDae <= 7)
      .sort((a, b) => (a.diasDae ?? 999) - (b.diasDae ?? 999))
      .slice(0, 12);
  }, [notasPeriodo]);
  const pendenciasPrioritarias = useMemo(() => {
    const peso = { critico: 0, alto: 1, medio: 2, baixo: 3 };
    return notasPeriodo
      .filter((nota) => nota.pendencias.length > 0)
      .sort((a, b) => {
        const risco = peso[a.risco as keyof typeof peso] - peso[b.risco as keyof typeof peso];
        if (risco !== 0) return risco;
        return b.valor - a.valor;
      })
      .slice(0, 12);
  }, [notasPeriodo]);
  const todasPendencias = useMemo(
    () => notasPeriodo
      .filter((nota) => nota.pendencias.length > 0)
      .sort((a, b) => {
        const peso = { critico: 0, alto: 1, medio: 2, baixo: 3 };
        return peso[a.risco as keyof typeof peso] - peso[b.risco as keyof typeof peso] || b.valor - a.valor;
      }),
    [notasPeriodo],
  );
  const fornecedoresResumo = useMemo(() => {
    const mapa = new Map<string, { fornecedor: string; cnpj: string; notas: number; valor: number; icms: number }>();
    for (const nota of notasPeriodo) {
      const chave = nota.emitenteCnpj || nota.emitenteNomeRelatorio;
      const atual = mapa.get(chave) ?? {
        fornecedor: nota.emitenteNomeRelatorio,
        cnpj: nota.emitenteCnpj ? formatarCnpj(nota.emitenteCnpj) : '',
        notas: 0,
        valor: 0,
        icms: 0,
      };
      atual.notas += 1;
      atual.valor += nota.valor;
      atual.icms += nota.icms;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => b.valor - a.valor);
  }, [notasPeriodo]);
  const notasTabela = useMemo(() => notasPeriodo.slice(0, limiteTabela), [notasPeriodo, limiteTabela]);

  useEffect(() => {
    setLimiteTabela(20);
  }, [inicioPeriodo, fimPeriodo, filtrosRelatorioAplicados, fornecedoresAplicadosRelatorio]);

  function selecionar(uf: string) {
    setUfSelecionada((atual) => (atual === uf ? null : uf));
  }

  const mesLabel = (chave: string) => {
    const [ano, mes] = chave.split('-');
    return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString(idioma, { month: 'short', year: '2-digit' });
  };
  const rt = (pt: string, zh: string) => idioma === 'zh-CN' ? zh : pt;

  const filtrosRelatorioPendentes =
    filtrosRelatorioAplicados.dataInicio !== dataInicio ||
    filtrosRelatorioAplicados.dataFim !== dataFim ||
    filtrosRelatorioAplicados.raizesEmpresa.join('\u0001') !== filtroRaizesEmpresaRelatorio.join('\u0001') ||
    filtrosRelatorioAplicados.tipo !== filtroTipoRelatorio ||
    filtrosRelatorioAplicados.situacoes.join('\u0001') !== filtroSituacoesRelatorio.join('\u0001') ||
    filtrosRelatorioAplicados.daes.join('\u0001') !== filtroDaesRelatorio.join('\u0001') ||
    filtrosRelatorioAplicados.fornecedores.join('\u0001') !== filtroFornecedoresRelatorio.join('\u0001') ||
    filtrosRelatorioAplicados.fornecedorAtivo !== fornecedorFiltroAtivo ||
    filtrosRelatorioAplicados.risco !== filtroRiscoRelatorio ||
    filtrosRelatorioAplicados.busca !== buscaRelatorio;

  function aplicarFiltrosRelatorio() {
    setFiltrosRelatorioAplicados({
      dataInicio,
      dataFim,
      raizesEmpresa: [...filtroRaizesEmpresaRelatorio],
      tipo: filtroTipoRelatorio,
      situacoes: [...filtroSituacoesRelatorio],
      daes: [...filtroDaesRelatorio],
      fornecedores: [...filtroFornecedoresRelatorio],
      fornecedorAtivo: fornecedorFiltroAtivo,
      risco: filtroRiscoRelatorio,
      busca: buscaRelatorio,
    });
    setUfSelecionada(null);
    setLimiteTabela(20);
  }

  function limparFiltrosRelatorio() {
    const situacoes = SITUACOES_RELATORIO_OPCOES.map((opcao) => opcao.valor);
    const daes = DAE_RELATORIO_OPCOES.map((opcao) => opcao.valor);
    setDataInicio('');
    setDataFim('');
    setFiltroRaizesEmpresaRelatorio(RAIZES_RELATORIO_PADRAO);
    setFiltroTipoRelatorio('todos');
    setFiltroSituacoesRelatorio(situacoes);
    setFiltroDaesRelatorio(daes);
    setFiltroFornecedoresRelatorio([]);
    setFornecedorFiltroAtivo(false);
    setBuscaFornecedorRelatorio('');
    setFiltroRiscoRelatorio('todos');
    setBuscaRelatorio('');
    setFiltrosRelatorioAplicados({
      dataInicio: '',
      dataFim: '',
      raizesEmpresa: RAIZES_RELATORIO_PADRAO,
      tipo: 'todos',
      situacoes,
      daes,
      fornecedores: [],
      fornecedorAtivo: false,
      risco: 'todos',
      busca: '',
    });
    setUfSelecionada(null);
    setLimiteTabela(20);
  }

  function nomeArquivoDownload(resposta: Response): string {
    const disposition = resposta.headers.get('content-disposition') ?? '';
    const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8?.[1]) return decodeURIComponent(utf8[1]);
    const simples = disposition.match(/filename="?([^";]+)"?/i);
    return simples?.[1] ?? 'relatorio-transporte.xlsx';
  }

  function filtrosRelatorioAtuais(): FiltrosRelatorioAplicados {
    return {
      dataInicio,
      dataFim,
      raizesEmpresa: [...filtroRaizesEmpresaRelatorio],
      tipo: filtroTipoRelatorio,
      situacoes: [...filtroSituacoesRelatorio],
      daes: [...filtroDaesRelatorio],
      fornecedores: [...filtroFornecedoresRelatorio],
      fornecedorAtivo: fornecedorFiltroAtivo,
      risco: filtroRiscoRelatorio,
      busca: buscaRelatorio,
    };
  }

  function montarParamsRelatorio(filtros = filtrosRelatorioAplicados): URLSearchParams {
    const params = new URLSearchParams();
    const inicio = filtros.dataInicio && filtros.dataFim && filtros.dataInicio > filtros.dataFim
      ? filtros.dataFim
      : filtros.dataInicio;
    const fim = filtros.dataInicio && filtros.dataFim && filtros.dataInicio > filtros.dataFim
      ? filtros.dataInicio
      : filtros.dataFim;
    const fornecedoresFiltro = filtros.fornecedorAtivo ? filtros.fornecedores : todosFornecedoresRelatorio;

    if (inicio) params.set('inicio', inicio);
    if (fim) params.set('fim', fim);
    if (filtros.raizesEmpresa.length === 0) params.append('raizCnpj', '__none__');
    else filtros.raizesEmpresa.forEach((raiz) => params.append('raizCnpj', raiz));
    if (filtros.tipo !== 'todos') params.set('tipo', filtros.tipo);
    if (filtros.situacoes.length !== SITUACOES_RELATORIO_OPCOES.length) {
      if (filtros.situacoes.length === 0) params.append('situacao', '__none__');
      else filtros.situacoes.forEach((situacao) => params.append('situacao', situacao));
    }
    if (filtros.daes.length !== DAE_RELATORIO_OPCOES.length) {
      if (filtros.daes.length === 0) params.append('dae', '__none__');
      else filtros.daes.forEach((dae) => params.append('dae', dae));
    }
    if (filtros.fornecedorAtivo) {
      if (fornecedoresFiltro.length === 0) params.append('fornecedor', '__none__');
      else fornecedoresFiltro.forEach((fornecedor) => params.append('fornecedor', fornecedor));
    }
    if (filtros.risco !== 'todos') params.set('risco', filtros.risco);
    if (filtros.busca.trim()) params.set('busca', filtros.busca.trim());
    return params;
  }

  async function baixarArquivoExcel(endpoint: string, erroPadrao: string) {
    const filtrosDownload = filtrosRelatorioAtuais();
    setFiltrosRelatorioAplicados(filtrosDownload);

    const resposta = await fetch(`${endpoint}?${montarParamsRelatorio(filtrosDownload).toString()}`, { cache: 'no-store' });
    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => null) as { message?: string } | null;
      throw new Error(erro?.message || erroPadrao);
    }

    const blob = await resposta.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArquivoDownload(resposta);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }

  async function baixarExcelTransporte() {
    setBaixandoExcelTransporte(true);
    setErroExcelTransporte(null);
    try {
      await baixarArquivoExcel('/api/relatorios/transporte-xlsx', 'Nao foi possivel gerar o Excel.');
    } catch (error: unknown) {
      setErroExcelTransporte((error as Error).message || 'Erro ao baixar Excel.');
    } finally {
      setBaixandoExcelTransporte(false);
    }
  }

  async function baixarExcelDaeVencidas() {
    setBaixandoExcelTransporte(true);
    setErroExcelTransporte(null);
    try {
      await baixarArquivoExcel('/api/relatorios/dae-vencidas-xlsx', 'Nao foi possivel gerar o Excel de DAE vencidas.');
    } catch (error: unknown) {
      setErroExcelTransporte((error as Error).message || 'Erro ao baixar Excel de DAE vencidas.');
    } finally {
      setBaixandoExcelTransporte(false);
    }
  }

  function csvValor(valor: unknown): string {
    return `"${String(valor ?? '').replace(/"/g, '""')}"`;
  }

  function baixarCsv(nome: string, cabecalho: string[], linhas: unknown[][]) {
    const conteudo = [cabecalho, ...linhas].map((linha) => linha.map(csvValor).join(';')).join('\r\n');
    const blob = new Blob([`\uFEFF${conteudo}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function baixarRelatorioNotasCsv() {
    baixarCsv('relatorio-notas-fiscais.csv', ['Emissao', 'NF', 'Serie', 'Empresa', 'Fornecedor', 'CNPJ fornecedor', 'UF', 'XML', 'Total NF', 'ICMS', 'DAE', 'Risco'], notasPeriodo.map((nota) => [
      data(nota.emitidaEm),
      numeroNotaSistema(nota),
      serieNotaSistema(nota),
      nota.empresaLabel,
      nota.emitenteNomeRelatorio,
      nota.emitenteCnpj ? formatarCnpj(nota.emitenteCnpj) : '',
      nota.uf,
      nota.status,
      nota.valor,
      nota.icms,
      textoDaeSitram(nota.daeStatus),
      nota.risco,
    ]));
  }

  function baixarRelatorioPendenciasCsv() {
    baixarCsv('relatorio-pendencias-fiscais.csv', ['NF', 'Emissao', 'Empresa', 'Fornecedor', 'Valor NF', 'Risco', 'Pendencias'], todasPendencias.map((nota) => [
      numeroNotaSistema(nota),
      data(nota.emitidaEm),
      nota.empresaLabel,
      nota.emitenteNomeRelatorio,
      nota.valor,
      nota.risco,
      nota.pendencias.join(' | '),
    ]));
  }

  function baixarRelatorioFornecedoresCsv() {
    baixarCsv('relatorio-fornecedores.csv', ['Fornecedor', 'CNPJ', 'Quantidade de NF', 'Valor total', 'ICMS'], fornecedoresResumo.map((fornecedor) => [
      fornecedor.fornecedor,
      fornecedor.cnpj,
      fornecedor.notas,
      fornecedor.valor,
      fornecedor.icms,
    ]));
  }

  function escaparHtmlRelatorio(valor: unknown): string {
    return String(valor ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function imprimirRelatorioPdf() {
    const janela = window.open('', '_blank', 'width=1200,height=800');
    if (!janela) {
      setErroExcelTransporte('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.');
      return;
    }

    const linhas = notasPeriodo.map((nota) => `<tr><td>${escaparHtmlRelatorio(data(nota.emitidaEm))}</td><td>${escaparHtmlRelatorio(numeroNotaSistema(nota))}</td><td>${escaparHtmlRelatorio(nota.empresaLabel)}</td><td>${escaparHtmlRelatorio(nota.emitenteNomeRelatorio)}</td><td>${escaparHtmlRelatorio(moeda(nota.valor))}</td><td>${escaparHtmlRelatorio(textoDaeSitram(nota.daeStatus))}</td><td>${escaparHtmlRelatorio(nota.risco)}</td></tr>`).join('');
    janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório fiscal DanfeCollector</title><style>body{font:12px Arial,sans-serif;color:#1f2937;padding:28px}h1{font-size:22px;margin:0 0 5px}p{color:#6b7280;margin:4px 0 18px}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #d1d5db;padding:7px;text-align:left}th{background:#f3f4f6;font-size:11px}td:nth-child(5){text-align:right}@media print{button{display:none}}</style></head><body><h1>Relatório fiscal</h1><p>DanfeCollector · ${escaparHtmlRelatorio(new Date().toLocaleString('pt-BR'))} · ${notasPeriodo.length} nota(s) · Total ${escaparHtmlRelatorio(moeda(totalValorPeriodo))}</p><table><thead><tr><th>Emissão</th><th>NF</th><th>Empresa</th><th>Fornecedor</th><th>Total NF</th><th>DAE</th><th>Risco</th></tr></thead><tbody>${linhas || '<tr><td colspan="7">Nenhuma nota no filtro atual.</td></tr>'}</tbody></table><script>window.onload=function(){window.print()}</script></body></html>`);
    janela.document.close();
  }

  return (
    <div className="report-shell mb-6 space-y-4">
      {/* Filtro por data */}
      <div className="report-card relative z-30 flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{rt('De', '开始日期')}</label>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="mt-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{rt('Até', '结束日期')}</label>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="mt-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          />
        </div>
        <ChecklistFiltro
          titulo="Empresa"
          opcoes={empresasRelatorio.map((empresa) => ({ valor: empresa.raiz, label: empresa.nome.toUpperCase(), sub: empresa.sub }))}
          selecionados={filtroRaizesEmpresaRelatorio}
          onToggle={(valor) => setFiltroRaizesEmpresaRelatorio((atuais) => alternarValorFiltro(atuais, valor))}
          onMarcarTodos={() => setFiltroRaizesEmpresaRelatorio(empresasRelatorio.map((empresa) => empresa.raiz))}
          onLimpar={() => setFiltroRaizesEmpresaRelatorio([])}
        />
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{rt('Tipo', '类型')}</label>
          <select
            value={filtroTipoRelatorio}
            onChange={(e) => setFiltroTipoRelatorio(e.target.value)}
            className="mt-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          >
            <option value="todos">{rt('Todos', '全部')}</option>
            {tiposRelatorio.map((tipo) => (
              <option key={tipo} value={tipo}>{tipo}</option>
            ))}
          </select>
        </div>
        <ChecklistFiltro
          titulo="Situacao"
          opcoes={SITUACOES_RELATORIO_OPCOES}
          selecionados={filtroSituacoesRelatorio}
          onToggle={(valor) => setFiltroSituacoesRelatorio((atuais) => alternarValorFiltro(atuais, valor))}
          onMarcarTodos={() => setFiltroSituacoesRelatorio(SITUACOES_RELATORIO_OPCOES.map((opcao) => opcao.valor))}
          onLimpar={() => setFiltroSituacoesRelatorio([])}
        />
        <ChecklistFiltro
          titulo="DAE"
          opcoes={DAE_RELATORIO_OPCOES}
          selecionados={filtroDaesRelatorio}
          onToggle={(valor) => setFiltroDaesRelatorio((atuais) => alternarValorFiltro(atuais, valor))}
          onMarcarTodos={() => setFiltroDaesRelatorio(DAE_RELATORIO_OPCOES.map((opcao) => opcao.valor))}
          onLimpar={() => setFiltroDaesRelatorio([])}
          maxHeight="max-h-44"
        />
        <ChecklistFiltro
          titulo="Fornecedor"
          opcoes={fornecedoresVisiveisRelatorio}
          selecionados={fornecedoresSelecionadosRelatorio}
          onToggle={(valor) => {
            setFornecedorFiltroAtivo(true);
            setFiltroFornecedoresRelatorio((atuais) => {
              const base = fornecedorFiltroAtivo ? atuais : todosFornecedoresRelatorio;
              return alternarValorFiltro(base, valor);
            });
          }}
          onMarcarTodos={() => {
            setFornecedorFiltroAtivo(false);
            setFiltroFornecedoresRelatorio([]);
          }}
          onLimpar={() => {
            setFornecedorFiltroAtivo(true);
            setFiltroFornecedoresRelatorio([]);
          }}
          extra={
            <input
              value={buscaFornecedorRelatorio}
              onChange={(e) => setBuscaFornecedorRelatorio(e.target.value)}
              placeholder="Buscar fornecedor"
              className="mb-2 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--ink)]"
            />
          }
          className="min-w-[190px]"
          maxHeight="max-h-44"
        />
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{rt('Risco', '风险')}</label>
          <select
            value={filtroRiscoRelatorio}
            onChange={(e) => setFiltroRiscoRelatorio(e.target.value)}
            className="mt-1 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          >
            <option value="todos">{rt('Todos', '全部')}</option>
            <option value="baixo">{rt('Baixo', '低')}</option>
            <option value="medio">{rt('Médio', '中')}</option>
            <option value="alto">{rt('Alto', '高')}</option>
            <option value="critico">{rt('Crítico', '严重')}</option>
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-mut)]">{rt('Buscar', '搜索')}</label>
          <input
            value={buscaRelatorio}
            onChange={(e) => setBuscaRelatorio(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                aplicarFiltrosRelatorio();
              }
            }}
            placeholder={rt('Nota, chave, fornecedor ou CNPJ', '发票、密钥、供应商或 CNPJ')}
            className="mt-1 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--ink)]"
          />
        </div>
        <button
          type="button"
          onClick={aplicarFiltrosRelatorio}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-md"
        >
          {filtrosRelatorioPendentes ? rt('Aplicar filtros', 'åº”ç”¨ç­›é€‰') : rt('Confirmar busca', 'ç¡®è®¤æœç´¢')}
        </button>
        <button
          type="button"
          onClick={limparFiltrosRelatorio}
          className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--ink-mut)] hover:bg-[var(--surface-2)]"
        >
          {rt('Limpar filtros', 'æ¸…é™¤ç­›é€‰')}
        </button>
        {(dataInicio || dataFim) && (
          <button
            onClick={() => { setDataInicio(''); setDataFim(''); }}
            className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--ink-mut)] hover:bg-[var(--surface-2)]"
          >
            {rt('Limpar datas', '清除日期')}
          </button>
        )}
        {ufSelecionada && (
          <button
            onClick={() => setUfSelecionada(null)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            ← {rt('Ver todo o Brasil', '查看整个巴西')}
          </button>
        )}
        <button
          type="button"
          onClick={baixarExcelTransporte}
          disabled={baixandoExcelTransporte}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
        >
          {baixandoExcelTransporte ? rt('Gerando Excel...', 'Excel...') : rt('Baixar Excel', 'Excel')}
        </button>
        <p className="ml-auto text-xs text-[var(--ink-mut)]">
          {rt(`${notasPeriodo.length} nota(s) no período`, `当前期间 ${notasPeriodo.length} 张发票`)} · {moeda(totalValorPeriodo)}
        </p>
        {erroExcelTransporte && (
          <p className="w-full text-sm font-medium text-red-700">{erroExcelTransporte}</p>
        )}
      </div>

      <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[var(--ink)]">Relatórios prontos</h2>
            <p className="mt-1 text-xs text-[var(--ink-mut)]">Os arquivos usam o filtro aplicado acima.</p>
          </div>
          <span className="text-xs text-[var(--ink-mut)]">{notasPeriodo.length} nota(s) selecionada(s)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={baixarRelatorioNotasCsv} className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]">
            Notas fiscais CSV
          </button>
          <button type="button" onClick={baixarRelatorioPendenciasCsv} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100">
            Pendências CSV ({todasPendencias.length})
          </button>
          <button type="button" onClick={baixarRelatorioFornecedoresCsv} className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]">
            Fornecedores CSV
          </button>
          <button type="button" onClick={baixarExcelDaeVencidas} disabled={baixandoExcelTransporte} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60">
            DAE vencidas Excel
          </button>
          <button type="button" onClick={imprimirRelatorioPdf} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white hover:brightness-110">
            Imprimir / salvar PDF
          </button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={rt('Notas no período', '期间发票')} value={String(notasPeriodo.length)} sub={inicioPeriodo || fimPeriodo ? rt('Filtrado por data', '按日期筛选') : rt('Base carregada', '已加载数据')} tone="neu" />
        <KpiCard label={rt('Valor total', '总金额')} value={moeda(totalValorPeriodo)} sub={rt('Soma das NF emitidas', '已开发票合计')} tone="good" />
        <KpiCard label={rt('UFs com movimento', '有交易的州')} value={String(ranking.length)} sub={rt('Estados com nota', '有发票的州')} tone="neu" />
        <KpiCard label={rt('Maior UF', '金额最高的州')} value={topUf?.uf ?? '—'} sub={topUf ? moeda(topUf.valor) : rt('Sem dados', '无数据')} tone="warn" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="ICMS destacado" value={moeda(resumoFiscal.icms)} sub="Campo ICMS do XML" tone="warn" />
        <KpiCard label="DAE pago" value={moeda(resumoFiscal.impostoPago)} sub={`${resumoFiscal.daePagoQtd} nota(s) paga(s)`} tone="good" />
        <KpiCard label="DAE a pagar" value={moeda(resumoFiscal.impostoPendente)} sub={`${resumoFiscal.daeAbertoQtd} nota(s) em aberto/a gerar`} tone="crit" />
        <KpiCard label="Sem consulta SITRAM" value={String(resumoFiscal.semSitram)} sub={`${resumoFiscal.canceladas} cancelada/denegada`} tone="warn" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={rt('Mês anterior', '上月对比')}
          value={comparativoMes.variacao === null ? '-' : `${comparativoMes.variacao >= 0 ? '+' : ''}${comparativoMes.variacao.toFixed(1)}%`}
          sub={`${comparativoMes.anterior ? mesLabel(comparativoMes.anterior) : 'sem base'} -> ${comparativoMes.atual ? mesLabel(comparativoMes.atual) : 'sem mes'}`}
          tone={comparativoMes.variacao !== null && comparativoMes.variacao < 0 ? 'warn' : 'good'}
        />
        <KpiCard label="Aguardando conf." value={String(resumoFiscal.aguardandoConferencia)} sub="XML completo pendente" tone="warn" />
        <KpiCard label="DAE vencido" value={moeda(resumoFiscal.daeVencidoValor)} sub={`${resumoFiscal.daeVencidoQtd} nota(s)`} tone="crit" />
        <KpiCard label={rt('Risco crítico/alto', '严重/高风险')} value={String(resumoFiscal.riscos.critico + resumoFiscal.riscos.alto)} sub={rt(`${resumoFiscal.riscos.medio} risco médio`, `${resumoFiscal.riscos.medio} 项中等风险`)} tone="crit" />
      </div>

      {(carregando || temMais) && (
        <div className="report-card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--ink-mut)]">
          <span>
            {carregando
              ? rt('Carregando um lote de relatórios...', '正在加载一批报表...')
              : rt(`${notas.length} de ${total} notas carregadas.`, `已加载 ${notas.length} / ${total} 张发票。`)}
          </span>
          {temMais && (
            <button type="button" onClick={onCarregarMais} disabled={carregando} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50">
              {carregando ? rt('Carregando...', '加载中...') : rt(`Carregar mais ${TAMANHO_PAGINA_RELATORIO}`, `再加载 ${TAMANHO_PAGINA_RELATORIO} 条`)}
            </button>
          )}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(320px,0.82fr)_minmax(360px,1.18fr)]">
        {/* Mapa interativo */}
        <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[var(--ink)]">{rt('Mapa do Brasil por UF', '巴西各州地图')}</h2>
              <p className="text-xs text-[var(--ink-mut)]">
                {ufSelecionada ? rt('Clique no estado destacado para voltar.', '单击高亮州返回。') : rt('Selecione um estado para ver os detalhes.', '选择一个州查看详情。')}
              </p>
            </div>
            {!ufSelecionada && (
              <div className="flex items-center gap-2 text-xs text-[var(--ink-mut)]">
                <span className="h-3 w-7 rounded bg-[#e5e7eb]" />
                <span>{rt('baixo', '低')}</span>
                <span className="h-3 w-7 rounded bg-[#047857]" />
                <span>{rt('alto', '高')}</span>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-[var(--surface-2)] p-2 sm:p-3">
            <MapaBrasil
              valores={valores}
              maxValor={maxValor}
              selecionada={ufSelecionada}
              onSelect={selecionar}
            />
          </div>
        </section>

        {/* Painel de relatório: estado selecionado OU ranking geral */}
        <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          {ufSelecionada && detalheUf ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-[var(--ink)]">
                  {nomeUf(ufSelecionada)} <span className="text-[var(--ink-mut)]">({ufSelecionada})</span>
                </h2>
                <p className="text-xs text-[var(--ink-mut)]">{rt('Resumo do estado no período selecionado.', '当前期间的州别摘要。')}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--ink-mut)]">Notas</p>
                  <p className="text-xl font-bold text-[var(--ink)]">{detalheUf.qtd}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11px] uppercase tracking-wider text-[var(--ink-mut)]">Valor</p>
                  <p className="text-xl font-bold text-emerald-700">{moeda(detalheUf.valor)}</p>
                </div>
              </div>

              {detalheUf.meses.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-bold text-[var(--ink)]">Por mês</h3>
                  <div className="space-y-1.5">
                    {detalheUf.meses.map(([chave, v]) => (
                      <div key={chave} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-[var(--ink-mut)]">{mesLabel(chave)}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${detalheUf.maxMes ? Math.max(4, (v.valor / detalheUf.maxMes) * 100) : 0}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-xs font-semibold text-[var(--ink)]">{moeda(v.valor)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-bold text-[var(--ink)]">Maiores emitentes</h3>
                <div className="space-y-2">
                  {detalheUf.topEmitentes.map((e, i) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-[var(--ink)]" title={e.nome}>{e.nome}</span>
                        <span className="shrink-0 text-sm font-semibold text-[var(--ink)]">{moeda(e.valor)}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--ink-mut)]">{e.qtd} nota(s)</div>
                    </div>
                  ))}
                  {detalheUf.topEmitentes.length === 0 && (
                    <p className="text-sm text-[var(--ink-mut)]">Sem notas deste estado no período.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <h2 className="mb-3 text-base font-bold text-[var(--ink)]">{rt('Ranking por estado', '各州排名')}</h2>
              <div className="space-y-2">
                {ranking.slice(0, 14).map((item) => (
                  <button
                    key={item.uf}
                    onClick={() => selecionar(item.uf)}
                    className="w-full rounded-lg border border-[var(--border)] p-3 text-left transition hover:border-emerald-500 hover:bg-[var(--surface-2)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold text-[var(--ink)]">{item.uf} <span className="font-normal text-[var(--ink-mut)]">{nomeUf(item.uf)}</span></span>
                      <span className="text-sm font-semibold text-[var(--ink)]">{moeda(item.valor)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${maxValor ? Math.max(4, (item.valor / maxValor) * 100) : 0}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-[var(--ink-mut)]">{item.qtd} nota(s)</div>
                  </button>
                ))}
                {ranking.length === 0 && (
                  <p className="text-sm text-[var(--ink-mut)]">Sem notas para montar o relatório no período.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-[var(--ink)]">{rt('Evolução mensal', '月度趋势')}</h2>
          <div className="space-y-2">
            {resumoFiscal.meses.slice(-12).map(([chave, v]) => (
              <div key={chave} className="rounded-lg border border-[var(--border)] p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm font-bold text-[var(--ink)]">{mesLabel(chave)}</span>
                  <span className="text-sm font-semibold text-[var(--ink)]">{moeda(v.valor)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div className="bar-progress h-full rounded-full bg-[var(--accent)]" style={{ width: `${resumoFiscal.maxMes ? Math.max(4, (v.valor / resumoFiscal.maxMes) * 100) : 0}%` }} />
                </div>
                <div className="mt-1 text-xs text-[var(--ink-mut)]">
                  {v.qtd} nota(s) - ICMS {moeda(v.icms)} - pago {moeda(v.pago)} - pendente {moeda(v.pendente)}
                </div>
              </div>
            ))}
            {resumoFiscal.meses.length === 0 && (
              <p className="text-sm text-[var(--ink-mut)]">{rt('Sem movimento no período.', '当前期间无交易。')}</p>
            )}
          </div>
        </section>

        <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-[var(--ink)]">{rt('Principais emitentes', '主要开票方')}</h2>
          <div className="space-y-2">
            {resumoFiscal.topEmitentes.map((emitente, i) => (
              <div key={`${emitente.nome}-${i}`} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-semibold text-[var(--ink)]" title={emitente.nome}>{emitente.nome}</span>
                  <span className="shrink-0 text-sm font-bold text-[var(--ink)]">{moeda(emitente.valor)}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--ink-mut)]">
                  {emitente.qtd} nota(s) - ICMS {moeda(emitente.icms)}
                </div>
              </div>
            ))}
            {resumoFiscal.topEmitentes.length === 0 && (
              <p className="text-sm text-[var(--ink-mut)]">{rt('Sem emitentes no período.', '当前期间无开票方。')}</p>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[var(--ink)]">{rt('DAEs vencidos e próximos', '逾期及即将到期的 DAE')}</h2>
            <button
              type="button"
              onClick={baixarExcelDaeVencidas}
              disabled={baixandoExcelTransporte}
              className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Baixar planilha das vencidas
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-[var(--ink-mut)]">
                <tr>
                  <th className="px-2 py-2 font-semibold">NF</th>
                  <th className="px-2 py-2 font-semibold">Fornecedor</th>
                  <th className="px-2 py-2 font-semibold">Venc.</th>
                  <th className="px-2 py-2 text-right font-semibold">Valor</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {daesPrioritarios.map((nota) => (
                  <tr key={`dae-${nota.id}`}>
                    <td className="px-2 py-2 font-semibold text-[var(--ink)]">{numeroNotaSistema(nota) || '-'}</td>
                    <td className="max-w-[220px] truncate px-2 py-2 text-[var(--ink)]" title={nota.emitenteNomeRelatorio}>{nota.emitenteNomeRelatorio}</td>
                    <td className="px-2 py-2 text-[var(--ink)]">{nota.daeVencimento ? data(nota.daeVencimento) : '-'}</td>
                    <td className="px-2 py-2 text-right font-semibold text-[var(--ink)]">{moeda(nota.impostoPendente)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={nota.diasDae !== null && nota.diasDae < 0 ? 'red' : 'amber'}>
                        {nota.diasDae !== null && nota.diasDae < 0 ? `${Math.abs(nota.diasDae)}d vencido` : `${nota.diasDae ?? 0}d`}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {daesPrioritarios.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-4 text-center text-[var(--ink-mut)]">Sem DAE vencido ou vencendo em 7 dias.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="mb-3 text-base font-bold text-[var(--ink)]">{rt('Pendências e risco fiscal', '待处理事项与税务风险')}</h2>
          <div className="space-y-2">
            {pendenciasPrioritarias.map((nota) => (
              <div key={`pend-${nota.id}`} className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--ink)]" title={nota.emitenteNomeRelatorio}>
                      NF {numeroNotaSistema(nota) || '-'} - {nota.emitenteNomeRelatorio}
                    </div>
                    <div className="mt-1 text-xs text-[var(--ink-mut)]">{nota.pendencias.join(' | ')}</div>
                  </div>
                  <Badge tone={nota.risco === 'critico' ? 'red' : nota.risco === 'alto' ? 'orange' : 'amber'}>
                    {nota.risco === 'critico' ? rt('crítico', '严重') : nota.risco === 'medio' ? rt('médio', '中') : nota.risco === 'alto' ? rt('alto', '高') : rt('baixo', '低')}
                  </Badge>
                </div>
              </div>
            ))}
            {pendenciasPrioritarias.length === 0 && (
              <p className="text-sm text-[var(--ink-mut)]">{rt('Sem pendências no filtro atual.', '当前筛选无待处理事项。')}</p>
            )}
          </div>
        </section>
      </div>

      <section className="report-card rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--ink)]">{rt('Relatório de notas', '发票报表')}</h2>
            <p className="text-xs text-[var(--ink-mut)]">{rt(`Mostrando até ${limiteTabela} linhas do filtro atual.`, `当前筛选最多显示 ${limiteTabela} 行。`)}</p>
          </div>
          <div className="text-xs text-[var(--ink-mut)]">{notasPeriodo.length} nota(s) filtrada(s)</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] text-left text-xs">
            <thead className="text-[var(--ink-mut)]">
              <tr>
                <th className="px-2 py-2 font-semibold">{rt('Emissão', '开票日期')}</th>
                <th className="px-2 py-2 font-semibold">NF</th>
                <th className="px-2 py-2 font-semibold">{rt('Série', '系列')}</th>
                <th className="px-2 py-2 font-semibold">Empresa</th>
                <th className="px-2 py-2 font-semibold">Fornecedor</th>
                <th className="px-2 py-2 font-semibold">UF</th>
                <th className="px-2 py-2 text-right font-semibold">Produtos</th>
                <th className="px-2 py-2 text-right font-semibold">Total</th>
                <th className="px-2 py-2 text-right font-semibold">ICMS</th>
                <th className="px-2 py-2 font-semibold">DAE</th>
                <th className="px-2 py-2 font-semibold">Risco</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {notasTabela.map((nota) => (
                <tr key={`nota-rel-${nota.id}`} className="hover:bg-[var(--surface-2)]">
                  <td className="px-2 py-2 text-[var(--ink)]">{data(nota.emitidaEm)}</td>
                  <td className="px-2 py-2 font-semibold text-[var(--ink)]">{numeroNotaSistema(nota) || '-'}</td>
                  <td className="px-2 py-2 text-[var(--ink-mut)]">{serieNotaSistema(nota) || '-'}</td>
                  <td className="max-w-[180px] truncate px-2 py-2 text-[var(--ink)]" title={nota.empresaLabel}>{nota.empresaLabel}</td>
                  <td className="max-w-[260px] truncate px-2 py-2 text-[var(--ink)]" title={nota.emitenteNomeRelatorio}>{nota.emitenteNomeRelatorio}</td>
                  <td className="px-2 py-2 text-[var(--ink)]">{nota.uf || '-'}</td>
                  <td className="px-2 py-2 text-right text-[var(--ink)]">{moeda(nota.valorProdutos ?? 0)}</td>
                  <td className="px-2 py-2 text-right font-semibold text-[var(--ink)]">{moeda(nota.valor)}</td>
                  <td className="px-2 py-2 text-right text-[var(--ink)]">{moeda(nota.icms)}</td>
                  <td className="px-2 py-2"><Badge tone={nota.daeStatus === 'PAGO' ? 'green' : nota.daePendente ? 'red' : 'gray'}>{textoDaeSitram(nota.daeStatus)}</Badge></td>
                  <td className="px-2 py-2"><Badge tone={nota.risco === 'baixo' ? 'green' : nota.risco === 'medio' ? 'amber' : nota.risco === 'alto' ? 'orange' : 'red'}>{nota.risco === 'critico' ? rt('crítico', '严重') : nota.risco === 'medio' ? rt('médio', '中') : nota.risco === 'alto' ? rt('alto', '高') : rt('baixo', '低')}</Badge></td>
                </tr>
              ))}
              {notasTabela.length === 0 && (
                <tr><td colSpan={11} className="px-2 py-4 text-center text-[var(--ink-mut)]">Nenhuma nota no filtro atual.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {notasTabela.length < notasPeriodo.length && (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setLimiteTabela((atual) => atual + 20)} className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:-translate-y-0.5 hover:bg-[var(--surface-2)] hover:shadow-sm">
              {rt('Mostrar mais 20 linhas', '再显示 20 行')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, sub, tone = 'neu' }: { label: string; value: string; sub?: string; tone?: 'neu' | 'good' | 'warn' | 'crit' }) {
  const stripe = { neu: 'var(--accent)', good: 'var(--good)', warn: 'var(--warn)', crit: 'var(--crit)' }[tone];
  const valColor = tone === 'crit' ? 'var(--crit)' : tone === 'warn' ? 'var(--warn)' : 'var(--ink)';
  return (
    <div className="relative overflow-hidden bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4 shadow-sm">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: stripe }} />
      <p className="text-[11px] uppercase tracking-wider text-[var(--ink-mut)] font-semibold">{label}</p>
      <p className="text-2xl font-bold tracking-tight truncate mt-1.5" style={{ color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p className="text-xs text-[var(--ink-mut)] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'gray' | 'blue' | 'sky' | 'orange' | 'indigo' | 'red'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-[var(--surface-2)] text-[var(--ink-mut)]',
    blue: 'bg-[var(--accent-soft)] text-[var(--accent)]',
    sky: 'bg-sky-100 text-sky-700',
    orange: 'bg-orange-100 text-orange-700',
    indigo: 'bg-violet-100 text-violet-700',
    red: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`shrink-0 text-[10px] px-2 py-1 rounded-full font-bold tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function CampoFiltroNotas({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block min-h-4 text-xs font-semibold leading-4 text-slate-700">
        {label.trim() ? label : ''}
      </span>
      {children}
    </div>
  );
}

function normalizarBuscaFiltro(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function CampoBuscaOpcoesFiltro({
  valor,
  opcoes,
  placeholder,
  onChange,
}: {
  valor: string;
  opcoes: string[];
  placeholder: string;
  onChange: (valor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState(valor);
  const ref = useRef<HTMLDivElement | null>(null);
  const usarPopup = opcoes.length > 10;

  useEffect(() => {
    setBusca(valor);
  }, [valor]);

  useEffect(() => {
    if (!aberto || !usarPopup) return;
    function fecharFora(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fecharFora);
    return () => document.removeEventListener('mousedown', fecharFora);
  }, [aberto, usarPopup]);

  const sugestoes = useMemo(() => {
    const termo = normalizarBuscaFiltro(busca);
    const digitos = busca.replace(/\D/g, '');
    const filtradas = termo || digitos
      ? opcoes.filter((opcao) => {
          const normalizada = normalizarBuscaFiltro(opcao);
          const numeros = opcao.replace(/\D/g, '');
          return normalizada.includes(termo) || (digitos.length > 0 && numeros.includes(digitos));
        })
      : opcoes;

    return filtradas
      .sort((a, b) => {
        const termoAtual = normalizarBuscaFiltro(busca);
        const aNome = normalizarBuscaFiltro(a);
        const bNome = normalizarBuscaFiltro(b);
        const aInicio = termoAtual && aNome.startsWith(termoAtual) ? 0 : 1;
        const bInicio = termoAtual && bNome.startsWith(termoAtual) ? 0 : 1;
        return aInicio - bInicio || a.localeCompare(b, 'pt-BR');
      })
      .slice(0, termo || digitos ? 30 : 50);
  }, [busca, opcoes]);

  if (!usarPopup) {
    return (
      <select value={valor} onChange={(e) => onChange(e.target.value)} className={CAMPO_FILTRO_NOTAS}>
        <option value="">{placeholder}</option>
        {opcoes.map((opcao) => (
          <option key={opcao} value={opcao}>{opcao}</option>
        ))}
      </select>
    );
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={busca}
        onFocus={() => setAberto(true)}
        onChange={(e) => {
          setBusca(e.target.value);
          onChange(e.target.value);
          setAberto(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAberto(false);
        }}
        placeholder={placeholder}
        className={`${CAMPO_FILTRO_NOTAS} pr-9`}
      />
      {busca && (
        <button
          type="button"
          onClick={() => {
            setBusca('');
            onChange('');
            setAberto(false);
          }}
          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          aria-label="Limpar"
        >
          x
        </button>
      )}
      {aberto && (
        <div className="absolute left-0 right-0 top-11 z-50 max-h-72 overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 text-sm shadow-xl">
          <button
            type="button"
            onClick={() => {
              setBusca('');
              onChange('');
              setAberto(false);
            }}
            className="block w-full px-3 py-2.5 text-left font-semibold text-slate-700 hover:bg-slate-100"
          >
            {placeholder}
          </button>
          {sugestoes.map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => {
                setBusca(opcao);
                onChange(opcao);
                setAberto(false);
              }}
              className="block w-full truncate px-3 py-2.5 text-left font-semibold text-slate-900 hover:bg-blue-600 hover:text-white"
              title={opcao}
            >
              {opcao}
            </button>
          ))}
          {sugestoes.length === 0 && (
            <div className="px-3 py-2.5 text-slate-500">Nenhuma recomendacao encontrada.</div>
          )}
        </div>
      )}
    </div>
  );
}

function GrupoCheckboxFiltro({
  titulo,
  opcoes,
  selecionados,
  onToggle,
}: {
  titulo: string;
  opcoes: Array<{ valor: string; label: string }>;
  selecionados: string[];
  onToggle: (valor: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-bold text-slate-900">{titulo}</legend>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
        {opcoes.map((opcao) => (
          <label key={opcao.valor} className="flex min-w-0 items-center gap-2 text-sm leading-5 text-slate-800">
            <input
              type="checkbox"
              checked={selecionados.includes(opcao.valor)}
              onChange={() => onToggle(opcao.valor)}
              className="h-4 w-4 shrink-0 rounded border-slate-400 text-slate-900 focus:ring-slate-500"
            />
            <span className="truncate" title={opcao.label}>{opcao.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ItemAlertaDae {
  id: string;
  nota: NotaComCnpj;
  lancamento: LancamentoDaeNormalizado | null;
  classificacao: string;
  numeroNota: string | null;
  dataChave: string | null;
  dias: number | null;
  situacao: string | null;
}

function deslocarData(dias: number): string {
  const valor = new Date();
  valor.setHours(12, 0, 0, 0);
  valor.setDate(valor.getDate() + dias);
  return chaveDataLocal(valor.toISOString()) ?? '';
}

function ImportarPagamentoSitram({
  onFechar,
  onAplicado,
}: {
  onFechar: () => void;
  onAplicado: () => void;
}) {
  const { t } = useIdioma();
  const [analisando, setAnalisando] = useState(false);
  const [preview, setPreview] = useState<PreviewPagamentoSitram | null>(null);
  const [referencia, setReferencia] = useState('');
  const [comprovante, setComprovante] = useState<File | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function handleAnalisar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const arquivos = fd.getAll('arquivo').filter((arquivo): arquivo is File => arquivo instanceof File && arquivo.size > 0);
    if (arquivos.length === 0) {
      setMsg({ ok: false, texto: t('selectPdf') });
      return;
    }
    setAnalisando(true);
    setMsg(null);
    const res = await previewPagamentoSitram(fd);
    setAnalisando(false);
    if (!res.ok) { setMsg({ ok: false, texto: res.message ?? t('analysisFailed') }); return; }
    setPreview(res);
  }

  const idsParaAplicar = (preview?.encontradas ?? []).filter((n) => !n.jaPago).map((n) => n.id);
  const totalAberto = (preview?.encontradas ?? []).reduce((t, n) => t + n.valorAberto, 0);

  async function handleConfirmar() {
    if (idsParaAplicar.length === 0) { setMsg({ ok: false, texto: t('nothingToMark') }); return; }
    setAplicando(true);
    setMsg(null);
    const res = await aplicarPagamentoSitram(idsParaAplicar, referencia);
    if (res.success && comprovante) {
      const fd = new FormData();
      fd.set('comprovante', comprovante);
      fd.set('nome', referencia.trim() ? `Comprovante ${referencia.trim()}` : 'Comprovante de pagamento');
      const resAnexo = await anexarComprovanteLote(idsParaAplicar, fd);
      setMsg({ ok: resAnexo.success, texto: `${res.message} ${resAnexo.message}` });
    } else {
      setMsg({ ok: res.success, texto: res.message });
    }
    setAplicando(false);
    if (res.success) onAplicado();
  }

  return (
    <div className="mb-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3 border-b border-[var(--border)] pb-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">{t('importPaymentTitle')}</h2>
        <button onClick={onFechar} className="text-sm text-[var(--ink-mut)] hover:text-[var(--ink)]">{t('close')} x</button>
      </div>

      {!preview ? (
        <form onSubmit={handleAnalisar} className="space-y-3">
          <p className="text-sm text-[var(--ink-mut)]">{t('paymentHelp')}</p>
          <input
            type="file"
            name="arquivo"
            accept="application/pdf,.pdf"
            multiple
            className="w-full text-sm text-[var(--ink-mut)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--ink)]"
          />
          <button type="submit" disabled={analisando}
            className="bg-[var(--accent)] text-[var(--accent-ink)] px-5 py-2 rounded-lg text-sm font-medium hover:brightness-150 disabled:opacity-50">
            {analisando ? t('analyzingPdf') : t('analyze')}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ink-mut)] font-semibold">{t('launches')}</p>
              <p className="text-xl font-bold text-[var(--ink)]">{preview.totalLancamentos}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ink-mut)] font-semibold">{t('foundNfs')}</p>
              <p className="text-xl font-bold" style={{ color: 'var(--good)' }}>{preview.encontradas.length}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ink-mut)] font-semibold">{t('notFound')}</p>
              <p className="text-xl font-bold" style={{ color: preview.naoEncontradas.length ? 'var(--crit)' : 'var(--ink)' }}>{preview.naoEncontradas.length}</p>
            </div>
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ink-mut)] font-semibold">{t('openAmount')}</p>
              <p className="text-xl font-bold text-[var(--ink)]">{moeda(totalAberto)}</p>
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {preview.encontradas.map((n) => (
              <div key={n.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="font-semibold text-[var(--ink)] w-20 shrink-0">NF {n.numero || '—'}</span>
                <span className="truncate flex-1 text-[var(--ink-mut)]" title={n.emitente || ''}>{n.emitente || formatarCnpj(n.cnpj)}</span>
                <span className="tabular-nums text-[var(--ink)]">{moeda(n.valorAberto)}</span>
                {n.jaPago && <Badge tone="green">já pago</Badge>}
              </div>
            ))}
            {preview.encontradas.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-[var(--ink-mut)]">Nenhuma NF do relatório bate com o banco.</p>
            )}
          </div>

          {preview.naoEncontradas.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-[var(--ink-mut)]">{preview.naoEncontradas.length} lançamento(s) não encontrado(s) no banco</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {preview.naoEncontradas.map((n, i) => (
                  <span key={i} className="rounded-lg bg-[var(--surface-2)] px-2 py-1 text-xs text-[var(--ink-mut)]">NF {n.numero} · {formatarCnpj(n.cnpj)}</span>
                ))}
              </div>
            </details>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-[var(--ink-mut)] mb-1">Referência do pagamento (opcional)</label>
              <input value={referencia} onChange={(e) => setReferencia(e.target.value)}
                placeholder="Ex.: DAE 05/2026 · lote maio"
                className="w-full border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm bg-[var(--surface)] text-[var(--ink)] focus:ring-2 focus:ring-[var(--border-strong)] outline-none" />
            </div>
            <div>
              <label className="block text-xs text-[var(--ink-mut)] mb-1">Comprovante para anexar a todas (opcional)</label>
              <input type="file" accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setComprovante(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-[var(--ink-mut)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--ink)]" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleConfirmar} disabled={aplicando || idsParaAplicar.length === 0}
              className="bg-[var(--accent)] text-[var(--accent-ink)] px-5 py-2 rounded-lg text-sm font-medium hover:brightness-150 disabled:opacity-50">
              {aplicando ? 'Aplicando…' : `Marcar ${idsParaAplicar.length} como pago${comprovante ? ' + anexar' : ''}`}
            </button>
            <button onClick={() => { setPreview(null); setMsg(null); }} className="px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border-strong)] text-[var(--ink)] hover:bg-[var(--surface-2)]">
              Trocar PDF
            </button>
          </div>
        </div>
      )}

      {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.texto}</p>}
    </div>
  );
}

function UsuariosAdminPainel({
  cnpjs,
  usuarios,
  carregando,
  usuarioEditando,
  onEditar,
  onNovo,
  action,
}: {
  cnpjs: CnpjComContagem[];
  usuarios: UsuarioAdminResumo[];
  carregando: boolean;
  usuarioEditando: UsuarioAdminResumo | null;
  onEditar: (usuario: UsuarioAdminResumo) => void;
  onNovo: () => void;
  action: (formData: FormData) => void;
}) {
  const selecionado = usuarioEditando;
  const cnpjsSelecionados = new Set(selecionado?.cnpjIds ?? []);
  const acessoTodos = selecionado?.acessoTodosCnpjs ?? false;

  return (
    <div className="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Usuarios e acesso por loja</h2>
          <p className="text-xs text-[var(--ink-mut)]">Crie login, defina nivel e escolha quais CNPJs a pessoa pode ver.</p>
        </div>
        <button type="button" onClick={onNovo} className="rounded-lg border border-[var(--border-strong)] px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]">
          Novo usuario
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase text-[var(--ink-mut)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Usuario</th>
                <th className="px-3 py-2 font-semibold">Nivel</th>
                <th className="px-3 py-2 font-semibold">Lojas</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {carregando ? (
                <tr><td colSpan={5} className="px-3 py-4 text-[var(--ink-mut)]">Carregando usuarios...</td></tr>
              ) : usuarios.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-[var(--ink-mut)]">Nenhum usuario cadastrado.</td></tr>
              ) : usuarios.map((u) => (
                <tr key={u.id} className="hover:bg-[var(--surface-2)]/60">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[var(--ink)]">{u.nome}</div>
                    <div className="text-xs font-mono text-[var(--ink-mut)]">{u.login}</div>
                  </td>
                  <td className="px-3 py-2"><Badge tone={u.perfil === 'admin' ? 'indigo' : 'gray'}>{u.perfil}</Badge></td>
                  <td className="px-3 py-2 text-xs text-[var(--ink-mut)]">{u.acessoTodosCnpjs ? 'Todas as lojas' : `${u.cnpjIds.length} loja(s)`}</td>
                  <td className="px-3 py-2"><Badge tone={u.ativo ? 'green' : 'red'}>{u.ativo ? 'Ativo' : 'Inativo'}</Badge></td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => onEditar(u)} className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]">
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form key={selecionado?.id ?? 'novo'} action={action} className="rounded-xl border border-[var(--border)] p-4">
          <input type="hidden" name="id" value={selecionado?.id ?? ''} />
          <h3 className="mb-3 text-sm font-bold text-[var(--ink)]">{selecionado ? 'Editar usuario' : 'Novo usuario'}</h3>
          <div className="space-y-2">
            <input name="nome" required defaultValue={selecionado?.nome ?? ''} placeholder="Nome" className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]" />
            <input name="login" required defaultValue={selecionado?.login ?? ''} placeholder="Login" className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]" />
            <input name="senha" type="password" placeholder={selecionado ? 'Nova senha (opcional)' : 'Senha'} className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]" />
            <select name="perfil" defaultValue={selecionado?.perfil ?? 'operador'} className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)]">
              <option value="operador">Operador</option>
              <option value="admin">Admin</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--ink)]">
              <input type="checkbox" name="ativo" defaultChecked={selecionado?.ativo ?? true} />
              Usuario ativo
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--ink)]">
              <input type="checkbox" name="acessoTodosCnpjs" defaultChecked={acessoTodos} />
              Pode ver todas as lojas
            </label>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-bold uppercase text-[var(--ink-mut)]">Lojas permitidas</div>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
              {cnpjs.map((cnpj) => (
                <label key={cnpj.id} className="flex gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--surface-2)]">
                  <input type="checkbox" name="cnpjIds" value={cnpj.id} defaultChecked={cnpjsSelecionados.has(cnpj.id)} />
                  <span>
                    <strong>{cnpj.razaoSocial || formatarCnpj(cnpj.cnpj)}</strong>
                    <span className="block font-mono text-[var(--ink-mut)]">{formatarCnpj(cnpj.cnpj)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[var(--ink-mut)]">Se "todas as lojas" estiver marcado, essa lista e ignorada.</p>
          </div>

          <button type="submit" className="mt-4 w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:brightness-125">
            {selecionado ? 'Salvar alteracoes' : 'Criar usuario'}
          </button>
        </form>
      </div>
    </div>
  );
}

function AlertaDaes({
  notas,
  cnpjId,
  onFiltrar,
}: {
  notas: NotaComCnpj[];
  cnpjId: number | 'todos';
  onFiltrar: (inicio: string, fim: string) => void;
}) {
  const { t } = useIdioma();
  const itens = useMemo<ItemAlertaDae[]>(() => {
    const resultado: ItemAlertaDae[] = [];

    for (const nota of notas) {
      if (cnpjId !== 'todos' && nota.cnpjId !== cnpjId) continue;
      const status = statusDaeEfetivo(nota);
      if (!DAE_A_PAGAR.includes(status)) continue;

      const resumo = extrairResumoDae(nota);
      const lancamentosRelevantes = lancamentosVisiveisDae(resumo.lancamentos);
      if (resumo.lancamentos.length > 0 && lancamentosRelevantes.length === 0) continue;
      const pendentes = lancamentosRelevantes.filter((lancamento) => !lancamento.pago);
      if (pendentes.length === 0) {
        resultado.push({
          id: `${nota.id}-sem-data`,
          nota,
          lancamento: null,
          classificacao: resumo.classificacao,
          numeroNota: resumo.numeroNota,
          dataChave: null,
          dias: null,
          situacao: resumo.situacaoImposto,
        });
        continue;
      }

      pendentes.forEach((lancamento, indice) => {
        resultado.push({
          id: `${nota.id}-${indice}`,
          nota,
          lancamento,
          classificacao: resumo.classificacao,
          numeroNota: resumo.numeroNota,
          dataChave: chaveDataLocal(lancamento.vencimento),
          dias: diasAteVencimento(lancamento.vencimento),
          situacao: resumo.situacaoImposto,
        });
      });
    }

    return resultado.sort((a, b) => {
      if (!a.dataChave) return 1;
      if (!b.dataChave) return -1;

      const dataCmp = a.dataChave.localeCompare(b.dataChave);
      if (dataCmp !== 0) return dataCmp;

      const grupoCmp = nomeGrupoEmpresa(a.nota.cnpj.cnpj).localeCompare(nomeGrupoEmpresa(b.nota.cnpj.cnpj));
      if (grupoCmp !== 0) return grupoCmp;

      const cnpjCmp = a.nota.cnpj.cnpj.localeCompare(b.nota.cnpj.cnpj);
      if (cnpjCmp !== 0) return cnpjCmp;

      return (numeroNotaSistema(a.nota) || a.numeroNota || '').localeCompare(numeroNotaSistema(b.nota) || b.numeroNota || '');
    });
  }, [notas, cnpjId]);

  const [aberto, setAberto] = useState(true);
  useEffect(() => {
    const v = typeof window !== 'undefined' ? localStorage.getItem('danfe-alerta-dae-aberto') : null;
    if (v !== null) setAberto(v === '1');
  }, []);
  function alternarAberto() {
    setAberto((a) => {
      try { localStorage.setItem('danfe-alerta-dae-aberto', a ? '0' : '1'); } catch {}
      return !a;
    });
  }

  // Filtro local (dentro do próprio alerta) por empresa e por período de vencimento
  const [filtroEmpresaAlerta, setFiltroEmpresaAlerta] = useState('');
  const [filtroInicioAlerta, setFiltroInicioAlerta] = useState('');
  const [filtroFimAlerta, setFiltroFimAlerta] = useState('');
  const [mostrarFiltroAlerta, setMostrarFiltroAlerta] = useState(false);
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const empresasAlerta = useMemo(() => {
    const nomes = new Set<string>();
    for (const item of itens) nomes.add(nomeGrupoEmpresa(item.nota.cnpj.cnpj));
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [itens]);

  const itensFiltrados = useMemo(() => {
    return itens.filter((item) => {
      if (filtroEmpresaAlerta && nomeGrupoEmpresa(item.nota.cnpj.cnpj) !== filtroEmpresaAlerta) return false;
      if (filtroInicioAlerta && (!item.dataChave || item.dataChave < filtroInicioAlerta)) return false;
      if (filtroFimAlerta && (!item.dataChave || item.dataChave > filtroFimAlerta)) return false;
      return true;
    });
  }, [itens, filtroEmpresaAlerta, filtroInicioAlerta, filtroFimAlerta]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, ItemAlertaDae[]>();
    for (const item of itensFiltrados) {
      const chave = item.dataChave ?? 'SEM_DATA';
      const grupo = mapa.get(chave) ?? [];
      grupo.push(item);
      mapa.set(chave, grupo);
    }
    return [...mapa.entries()];
  }, [itensFiltrados]);

  function limparFiltroAlerta() {
    setFiltroEmpresaAlerta('');
    setFiltroInicioAlerta('');
    setFiltroFimAlerta('');
  }

  if (itens.length === 0) return null;

  function disparar(chave: string, inicio: string, fim: string) {
    setSelecionado(chave);
    onFiltrar(inicio, fim);
  }

  const vencidos = itens.filter((item) => item.dias !== null && item.dias < 0);
  const vencemHoje = itens.filter((item) => item.dias === 0);
  const proximos = itens.filter((item) => item.dias !== null && item.dias > 0 && item.dias <= 7);
  const totalAberto = itens.reduce((total, item) => total + (item.lancamento?.valorAberto ?? 0), 0);
  const hoje = deslocarData(0);
  const filtroAlertaAtivo = Boolean(filtroEmpresaAlerta || filtroInicioAlerta || filtroFimAlerta);

  const BOTAO_BASE = 'rounded-lg border px-3 py-2 text-left shadow-sm transition cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-1';
  const BOTAO_SELECIONADO = 'ring-2 ring-offset-1 ring-[var(--ink)] scale-[1.03]';

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/60">
      <div className="border-b border-amber-200 bg-amber-100/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="font-bold text-[var(--ink)]">{t('daeAlertTitle')}</h2>
            <p className="text-xs text-[var(--ink-mut)]">{t('daeAlertSummary', { count: itens.length, amount: moeda(totalAberto) })}</p>
          </div>
          {vencidos.length > 0 && (
            <button
              type="button"
              onClick={() => disparar('vencidos', '', deslocarData(-1))}
              aria-pressed={selecionado === 'vencidos'}
              className={`${BOTAO_BASE} border-red-300 bg-red-600 text-white focus-visible:ring-red-400 ${selecionado === 'vencidos' ? BOTAO_SELECIONADO : ''}`}
            >
              <span className="block text-[10px] font-bold uppercase">{t('overdue')}</span>
              <span className="text-lg font-black">{vencidos.length}</span>
            </button>
          )}
          {vencemHoje.length > 0 && (
            <button
              type="button"
              onClick={() => disparar('hoje', hoje, hoje)}
              aria-pressed={selecionado === 'hoje'}
              className={`${BOTAO_BASE} border-orange-300 bg-orange-500 text-white focus-visible:ring-orange-400 ${selecionado === 'hoje' ? BOTAO_SELECIONADO : ''}`}
            >
              <span className="block text-[10px] font-bold uppercase">{t('dueToday')}</span>
              <span className="text-lg font-black">{vencemHoje.length}</span>
            </button>
          )}
          {proximos.length > 0 && (
            <button
              type="button"
              onClick={() => disparar('proximos', deslocarData(1), deslocarData(7))}
              aria-pressed={selecionado === 'proximos'}
              className={`${BOTAO_BASE} border-amber-300 bg-[var(--surface)] text-amber-800 focus-visible:ring-amber-400 ${selecionado === 'proximos' ? `${BOTAO_SELECIONADO} bg-amber-100` : ''}`}
            >
              <span className="block text-[10px] font-bold uppercase">{t('nextSevenDays')}</span>
              <span className="text-lg font-black">{proximos.length}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => disparar('todos', '', '')}
            aria-pressed={selecionado === 'todos'}
            className={`${BOTAO_BASE} border-[var(--border-strong)] bg-[var(--surface)] text-sm font-semibold text-[var(--ink)] focus-visible:ring-[var(--accent)] ${selecionado === 'todos' ? `${BOTAO_SELECIONADO} bg-[var(--accent-soft)]` : ''}`}
          >
            {t('viewAll')}
          </button>
          <button
            type="button"
            onClick={() => setMostrarFiltroAlerta((v) => !v)}
            aria-pressed={mostrarFiltroAlerta || filtroAlertaAtivo}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition ${
              mostrarFiltroAlerta || filtroAlertaAtivo
                ? 'border-amber-500 bg-amber-500 text-white'
                : 'border-amber-300 bg-[var(--surface)] text-amber-800 hover:bg-amber-50'
            }`}
          >
            🔎 Filtrar{filtroAlertaAtivo ? ` · ${itensFiltrados.length}` : ''}
          </button>
          <button
            type="button"
            onClick={alternarAberto}
            title={aberto ? t('minimizeList') : t('expandList')}
            className="rounded-lg border border-amber-300 bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-50"
          >
            {aberto ? `v ${t('minimize')}` : `> ${t('expand')}`}
          </button>
        </div>

        {(mostrarFiltroAlerta || filtroAlertaAtivo) && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-amber-200 pt-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase text-[var(--ink-mut)]">Empresa</label>
            <select
              value={filtroEmpresaAlerta}
              onChange={(e) => setFiltroEmpresaAlerta(e.target.value)}
              className="rounded-lg border border-amber-300 bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)]"
            >
              <option value="">Todas as empresas</option>
              {empresasAlerta.map((nome) => (
                <option key={nome} value={nome}>{nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase text-[var(--ink-mut)]">Vencimento de</label>
            <input
              type="date"
              value={filtroInicioAlerta}
              onChange={(e) => setFiltroInicioAlerta(e.target.value)}
              className="rounded-lg border border-amber-300 bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase text-[var(--ink-mut)]">até</label>
            <input
              type="date"
              value={filtroFimAlerta}
              onChange={(e) => setFiltroFimAlerta(e.target.value)}
              className="rounded-lg border border-amber-300 bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--ink)]"
            />
          </div>
          {filtroAlertaAtivo && (
            <button
              type="button"
              onClick={limparFiltroAlerta}
              className="rounded-lg border border-amber-300 bg-[var(--surface)] px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-50"
            >
              Limpar filtro
            </button>
          )}
          {filtroAlertaAtivo && (
            <span className="text-xs font-medium text-amber-800">
              Mostrando {itensFiltrados.length} de {itens.length} pendência(s)
            </span>
          )}
        </div>
        )}
      </div>

      {aberto && (
      <div className="max-h-[28rem] divide-y divide-amber-200 overflow-y-auto">
        {itensFiltrados.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-[var(--ink-mut)]">Nenhuma pendência para esse filtro.</p>
        )}
        {grupos.map(([dataGrupo, itensGrupo]) => {
          const diasGrupo = itensGrupo[0]?.dias ?? null;
          const valorGrupo = itensGrupo.reduce((total, item) => total + (item.lancamento?.valorAberto ?? 0), 0);
          const vencido = diasGrupo !== null && diasGrupo < 0;
          const venceHoje = diasGrupo === 0;
          const rotuloPrazo = dataGrupo === 'SEM_DATA'
            ? t('noDueDate')
            : vencido
              ? t('overdueDaysUpper', { days: Math.abs(diasGrupo!) })
              : venceHoje
                ? t('dueTodayUpper')
                : t('dueInDays', { days: diasGrupo ?? 0 });
          const chaveGrupo = `grupo-${dataGrupo}`;

          return (
            <div key={dataGrupo} className={vencido ? 'bg-red-50' : venceHoje ? 'bg-orange-50' : 'bg-[var(--surface-2)]'}>
              <button
                type="button"
                onClick={() => dataGrupo === 'SEM_DATA' ? disparar(chaveGrupo, '', '') : disparar(chaveGrupo, dataGrupo, dataGrupo)}
                aria-pressed={selecionado === chaveGrupo}
                className={`sticky top-0 z-10 flex w-full cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 text-left outline-none transition hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-[var(--ink)] ${
                  selecionado === chaveGrupo ? 'bg-[var(--accent-soft)] ring-2 ring-inset ring-[var(--accent)]' : (vencido ? 'bg-red-50' : venceHoje ? 'bg-orange-50' : 'bg-[var(--surface-2)]')
                }`}
              >
                <span className="font-bold text-[var(--ink)]">
                  {dataGrupo === 'SEM_DATA' ? t('noDueDateInfo') : data(`${dataGrupo}T12:00:00`)}
                </span>
                <Badge tone={vencido ? 'red' : venceHoje ? 'orange' : 'amber'}>{rotuloPrazo}</Badge>
                <span className="ml-auto text-sm font-bold text-[var(--ink)]">
                  {t('daeCountAmount', { count: itensGrupo.length, amount: moeda(valorGrupo) })}
                </span>
                <span className="text-xs font-semibold text-[var(--accent)]">{selecionado === chaveGrupo ? '✓ selecionado' : 'ver notas ➜'}</span>
              </button>
              <div className="grid gap-2 px-4 pb-3 md:grid-cols-2">
                {itensGrupo.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-sm">
                    <div className="flex items-center gap-2">
                      <strong className="text-[var(--ink)]">NF {numeroNotaSistema(item.nota) || item.numeroNota || '—'}</strong>
                      <Badge tone="indigo">{item.classificacao}</Badge>
                      <strong className="ml-auto text-[var(--ink)]">{moeda(item.lancamento?.valorAberto ?? null)}</strong>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="amber">{nomeGrupoEmpresa(item.nota.cnpj.cnpj)}</Badge>
                      <Badge tone="gray">{nomeEmpresaCurta(item.nota)}</Badge>
                      <span className="text-[11px] font-mono text-[var(--ink-mut)]">{formatarCnpj(item.nota.cnpj.cnpj)}</span>
                    </div>
                    <p className="mt-1 truncate text-[var(--ink-mut)]" title={item.nota.emitenteNome || ''}>
                      {item.nota.emitenteNome || t('issuerNotInformed')}
                    </p>
                    {(item.lancamento?.situacao || item.situacao) && (
                      <p className="mt-1 truncate text-[var(--ink-mut)]" title={item.lancamento?.situacao || item.situacao || ''}>
                        <span className="font-semibold text-[var(--ink)]">Situação:</span>{' '}
                        {item.lancamento?.situacao || item.situacao}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

function CompactFragmentNota({
  nota,
  aberta,
  onToggle,
  selecionavel,
  selecionada,
  onToggleSelecionada,
  onNotaAtualizada,
}: {
  nota: NotaComCnpj;
  aberta: boolean;
  onToggle: () => void;
  selecionavel: boolean;
  selecionada: boolean;
  onToggleSelecionada: () => void;
  onNotaAtualizada: (nota: NotaComCnpj) => void;
}) {
  const tags = parseEtiquetas(nota.etiqueta);
  const dae = extrairResumoDae(nota);
  const situacaoSitram = situacaoSitramEfetiva(nota);
  const statusDae = statusDaeEfetivo(nota);
  const lancamentoDestaque = dae.lancamentos.find((l) => !l.pago) ?? dae.lancamentos[0];
  const diasParaVencer = diasAteVencimento(lancamentoDestaque?.vencimento);
  return (
    <>
      <tr className={`cursor-pointer transition ${aberta ? 'bg-[var(--accent-soft)]/60' : 'hover:bg-[var(--surface-2)]'}`} onClick={onToggle}>
        <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className="text-[var(--ink-mut)] text-sm">{aberta ? 'v' : '>'}</span>
            {selecionavel && (
              <input
                type="checkbox"
                checked={selecionada}
                onChange={onToggleSelecionada}
                className="w-4 h-4"
              />
            )}
          </div>
        </td>
        <td className="px-3 py-3 align-top text-center">
          <p className="font-medium text-[var(--ink)] whitespace-nowrap">{data(nota.emitidaEm)}</p>
          <p className="text-xs text-[var(--ink-mut)]">NF {numeroNotaSistema(nota) || dae.numeroNota || '-'} / Serie {serieNotaSistema(nota) || '-'}</p>
          {nota.tipoOperacao && (
            <div className="mt-1">
              <Badge tone={nota.tipoOperacao === 'Entrada' ? 'sky' : 'orange'}>{nota.tipoOperacao}</Badge>
            </div>
          )}
        </td>
        <td className="px-3 py-3 align-top min-w-0 text-center">
          <p className="font-medium text-[var(--ink)] leading-snug line-clamp-2" title={nota.emitenteNome || ''}>
            {nota.emitenteNome || '-'}
          </p>
          <p className="text-xs text-[var(--ink-mut)] font-mono truncate text-center">{formatarCnpj(nota.emitenteCnpj)}</p>
          <p className="text-xs text-[var(--ink-mut)] truncate text-center">{nota.naturezaOp || ''}</p>
        </td>
        <td className="px-3 py-3 align-top min-w-0 text-center">
          <p className="font-medium text-[var(--ink)] leading-snug line-clamp-2" title={nota.destNome || ''}>
            {nota.destNome || '-'}
          </p>
          <p className="text-xs text-[var(--ink-mut)] font-mono truncate text-center">{formatarCnpj(nota.destCnpj)}</p>
          <p className="text-xs text-[var(--ink-mut)] truncate text-center">{nomeEmpresaCurta(nota)}</p>
        </td>
        <td className="px-3 py-3 align-top text-center">
          <p className="font-semibold text-[var(--ink)] whitespace-nowrap">{moeda(nota.valorTotal)}</p>
          <p className="text-xs text-[var(--ink-mut)] whitespace-nowrap">Frete {moeda(nota.valorFrete)}</p>
          <p className="text-xs text-[var(--ink-mut)]">{nota.qtdItens ?? '-'} item(ns)</p>
        </td>
        <td className="px-3 py-3 align-top min-w-0">
          <p className="text-[var(--ink)] truncate" title={nota.transportadoraNome || nota.modalidadeFrete || ''}>
            {nota.transportadoraNome || nota.modalidadeFrete || '-'}
          </p>
          <p className="text-xs text-[var(--ink-mut)] truncate">{nota.modalidadeFrete || '-'}</p>
          {nota.transportadoraCnpj && (
            <p className="text-xs text-[var(--ink-mut)] font-mono truncate">{formatarCnpj(nota.transportadoraCnpj)}</p>
          )}
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex flex-wrap gap-1.5">
            {nota.sitramConsultadaEm ? (
              <Badge tone={toneSelagemSitram(nota)}>{textoSelagemSitram(nota)}</Badge>
            ) : (
              <Badge tone="gray">Sem SITRAM</Badge>
            )}
            {nota.sitramDaeStatus ? (
              <Badge tone={toneDaeSitram(statusDae)}>{textoDaeSitram(statusDae)}</Badge>
            ) : (
              <Badge tone="gray">Sem DAE</Badge>
            )}
          </div>
          {lancamentoDestaque ? (
            <div className="mt-1">
              <p className="text-xs font-medium text-[var(--ink-mut)]">
                {statusDae === 'PAGO' ? 'Pago' : 'A pagar'}{' '}
                {moeda(statusDae === 'PAGO' ? lancamentoDestaque.valorPago : lancamentoDestaque.valorAberto)}
              </p>
              {lancamentoDestaque.vencimento && (
                <p className={`text-xs ${!lancamentoDestaque.pago && diasParaVencer !== null && diasParaVencer < 0 ? 'font-semibold text-red-600' : 'text-[var(--ink-mut)]'}`}>
                  Vence {data(lancamentoDestaque.vencimento)}
                  {!lancamentoDestaque.pago && diasParaVencer !== null && diasParaVencer < 0 ? ' • VENCIDO' : ''}
                </p>
              )}
            </div>
          ) : situacaoSitram && (
            <p className="mt-1 text-xs text-[var(--ink-mut)] truncate" title={situacaoSitram}>{situacaoSitram}</p>
          )}
          {situacaoSitram && lancamentoDestaque && (
            <p className="mt-1 text-xs text-[var(--ink-mut)] truncate" title={situacaoSitram}>{situacaoSitram}</p>
          )}
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={nota.status === 'COMPLETA' ? 'green' : 'blue'}>{nota.status}</Badge>
            {nota.situacaoSefaz === 'CANCELADA' && <Badge tone="orange">CANCELADA</Badge>}
            {nota.situacaoSefaz === 'DENEGADA' && <Badge tone="orange">DENEGADA</Badge>}
            {tags.slice(0, 2).map((tag) => <Badge key={tag} tone="indigo">{tag}</Badge>)}
            {tags.length > 2 && <Badge tone="gray">+{tags.length - 2}</Badge>}
          </div>
        </td>
      </tr>
      {aberta && (
        <tr className="bg-[var(--surface-2)]/70">
          <td colSpan={8} className="px-4 py-4">
            <DetalheNota nota={nota} onNotaAtualizada={onNotaAtualizada} />
          </td>
        </tr>
      )}
    </>
  );
}

function FragmentNota({
  nota,
  aberta,
  onToggle,
  selecionavel,
  selecionada,
  onToggleSelecionada,
}: {
  nota: NotaComCnpj;
  aberta: boolean;
  onToggle: () => void;
  selecionavel: boolean;
  selecionada: boolean;
  onToggleSelecionada: () => void;
}) {
  const tags = parseEtiquetas(nota.etiqueta);
  const situacaoSitram = situacaoSitramEfetiva(nota);
  const statusDae = statusDaeEfetivo(nota);
  return (
    <>
      <tr className={`cursor-pointer transition ${aberta ? 'bg-[var(--accent-soft)]/50' : 'hover:bg-[var(--surface-2)]'}`} onClick={onToggle}>
        <td className="py-3 text-center" onClick={(e) => e.stopPropagation()}>
          {selecionavel && (
            <input
              type="checkbox"
              checked={selecionada}
              onChange={onToggleSelecionada}
              className="w-4 h-4"
            />
          )}
        </td>
        <td className="py-3 text-[var(--ink-mut)] text-center">{aberta ? '▾' : '▸'}</td>
        <td className="py-3 whitespace-nowrap text-[var(--ink-mut)]">{data(nota.emitidaEm)}</td>
        <td className="py-3">
          {nota.tipoOperacao && (
            <Badge tone={nota.tipoOperacao === 'Entrada' ? 'sky' : 'orange'}>{nota.tipoOperacao}</Badge>
          )}
        </td>
        <td className="py-3">
          <p className="font-medium text-[var(--ink)] truncate max-w-[260px]">{nota.emitenteNome || '—'}</p>
          <p className="text-xs text-[var(--ink-mut)] font-mono">{formatarCnpj(nota.emitenteCnpj)}</p>
        </td>
        <td className="py-3 text-right whitespace-nowrap font-semibold text-[var(--ink)]">{moeda(nota.valorTotal)}</td>
        <td className="py-3 text-right whitespace-nowrap text-[var(--ink-mut)]">{moeda(nota.valorFrete)}</td>
        <td className="py-3">
          {nota.transportadoraNome || nota.modalidadeFrete ? (
            <div className="max-w-[220px]">
              <p className="text-[var(--ink)] truncate" title={nota.transportadoraNome || nota.modalidadeFrete || ''}>
                {nota.transportadoraNome || nota.modalidadeFrete}
              </p>
              {nota.transportadoraCnpj && (
                <p className="text-xs text-[var(--ink-mut)] font-mono">{formatarCnpj(nota.transportadoraCnpj)}</p>
              )}
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="py-3 text-right whitespace-nowrap text-[var(--ink-mut)]">{nota.qtdItens ?? '—'}</td>
        <td className="py-3">
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => <Badge key={tag} tone="indigo">{tag}</Badge>)}
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="py-3">
          <div className="flex flex-col gap-1">
            <Badge tone={nota.status === 'COMPLETA' ? 'green' : 'blue'}>{nota.status}</Badge>
            {nota.situacaoSefaz === 'CANCELADA' && (
              <Badge tone="orange">CANCELADA</Badge>
            )}
            {nota.situacaoSefaz === 'DENEGADA' && (
              <Badge tone="orange">DENEGADA</Badge>
            )}
          </div>
        </td>
        <td className="py-3">
          {nota.sitramConsultadaEm ? (
            <div className="flex flex-col gap-1 max-w-[180px]">
              <Badge tone={toneSelagemSitram(nota)}>{textoSelagemSitram(nota)}</Badge>
              {situacaoSitram && (
                <span className="text-[11px] text-[var(--ink-mut)] truncate" title={situacaoSitram}>
                  {situacaoSitram}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
        <td className="py-3">
          {nota.sitramDaeStatus ? (
            <div className="flex flex-col gap-1 max-w-[180px]">
              <Badge tone={toneDaeSitram(statusDae)}>{textoDaeSitram(statusDae)}</Badge>
              {nota.sitramDaeResumo && (
                <span className="text-[11px] text-[var(--ink-mut)] truncate" title={nota.sitramDaeResumo}>
                  {nota.sitramDaeResumo}
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-300">—</span>
          )}
        </td>
      </tr>
      {aberta && (
        <tr className="bg-[var(--surface-2)]/70">
          <td colSpan={13} className="px-4 py-4">
            <DetalheNota nota={nota} onNotaAtualizada={() => {}} />
          </td>
        </tr>
      )}
    </>
  );
}

type Aba = 'dados' | 'sitram' | 'frete' | 'danfe' | 'itens' | 'anexos';

function DetalheNota({
  nota,
  onNotaAtualizada,
}: {
  nota: NotaComCnpj;
  onNotaAtualizada: (nota: NotaComCnpj) => void;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('dados');
  const [danfe, setDanfe] = useState<DanfeData | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [manifestando, setManifestando] = useState(false);
  const [msgManifesto, setMsgManifesto] = useState<{ ok: boolean; texto: string } | null>(null);
  const [consultandoSitram, setConsultandoSitram] = useState(false);
  const [msgSitramNota, setMsgSitramNota] = useState<{ ok: boolean; texto: string } | null>(null);
  const [consultandoPagamentoIcms, setConsultandoPagamentoIcms] = useState(false);
  const [msgPagamentoIcms, setMsgPagamentoIcms] = useState<{ ok: boolean; texto: string } | null>(null);
  const [anexosDaePagamento, setAnexosDaePagamento] = useState<Record<string, AnexoInfo>>({});
  const [carregandoAnexosDaePagamento, setCarregandoAnexosDaePagamento] = useState(false);

  const ehResumo = nota.status === 'RESUMO';
  const espelhoSitram = useMemo(() => extrairEspelhoSitram(nota), [nota]);
  const pagamentoIcms = useMemo(() => extrairPagamentoIcmsSitram(nota), [nota]);
  const resumoDaeDetalhe = useMemo(() => extrairResumoDae(nota), [nota]);
  const lancamentosDaeDetalhe = useMemo(() => lancamentosVisiveisDae(resumoDaeDetalhe.lancamentos), [resumoDaeDetalhe.lancamentos]);
  const statusDaeDetalhe = statusDaeEfetivo(nota);
  const daeVencidoDetalhe = lancamentosDaeDetalhe.some((lancamento) => {
    const dias = diasAteVencimento(lancamento.vencimento);
    return !lancamento.pago && dias !== null && dias < 0;
  });
  const temDaeDetalhe =
    lancamentosDaeDetalhe.length > 0 ||
    pagamentoIcms.documentos.length > 0 ||
    pagamentoIcms.simulacoes.length > 0 ||
    ['PAGO', 'EM_ABERTO', 'LIBERADA_PARA_GERAR', 'COM_DAE'].includes(statusDaeDetalhe);
  const daeResumoClasse = daeVencidoDetalhe
    ? 'border-red-300 bg-red-50 text-red-800'
    : statusDaeDetalhe === 'PAGO'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
      : temDaeDetalhe || DAE_A_PAGAR.includes(statusDaeDetalhe)
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  const daeResumoTexto = !temDaeDetalhe
    ? 'Nao'
    : daeVencidoDetalhe
      ? 'Vencido'
      : statusDaeDetalhe === 'PAGO'
        ? 'Pago'
        : DAE_A_PAGAR.includes(statusDaeDetalhe)
          ? 'Aberto'
          : textoDaeSitram(statusDaeDetalhe);
  const codigosDaePagamento = useMemo(() => {
    return Array.from(
      new Set(
        pagamentoIcms.documentos
          .map((documento) => normalizarCodigoDae(documento.codigoDocumento))
          .filter(Boolean),
      ),
    );
  }, [pagamentoIcms.documentos]);
  const codigosDaePagamentoChave = codigosDaePagamento.join('|');
  const [tagsOtimizadas, setTagsOtimizadas] = useState<string[]>(() => parseEtiquetas(nota.etiqueta));

  useEffect(() => {
    setTagsOtimizadas(parseEtiquetas(nota.etiqueta));
  }, [nota.etiqueta]);

  async function handleClicarEtiqueta(tag: string) {
    const antes = tagsOtimizadas;
    const depois = antes.includes(tag) ? antes.filter((item) => item !== tag) : [...antes, tag];
    setTagsOtimizadas(depois);
    const res = await alternarEtiqueta(nota.id, tag);
    if (!res.success) {
      setTagsOtimizadas(antes);
      return;
    }
    router.refresh();
  }

  // Pré-carrega o DANFE assim que a nota é aberta (não espera o clique na aba)
  useEffect(() => {
    if (!ehResumo && !danfe && !erro && !carregando) {
      const cache = lerDanfeCacheLocal(nota.id);
      if (cache) {
        setDanfe(cache);
        return;
      }
      setCarregando(true);
      obterDetalheNota(nota.id).then((res) => {
        if (res.ok) {
          setDanfe(res.danfe);
          salvarDanfeCacheLocal(nota.id, res.danfe);
        } else setErro(res.message);
        setCarregando(false);
      });
    }
  }, [danfe, erro, carregando, nota.id, ehResumo]);

  async function handleManifestar() {
    setManifestando(true);
    setMsgManifesto(null);
    const res = await manifestarNota(nota.id);
    setMsgManifesto({ ok: res.success, texto: res.message });
    setManifestando(false);
    if (res.success) {
      const atualizada = await obterNotaPorId(nota.id);
      if (atualizada) onNotaAtualizada(atualizada);
    }
  }

  async function handleAtualizarSitramNota() {
    setConsultandoSitram(true);
    setMsgSitramNota(null);
    const res = await atualizarSitramPorChaves([nota.chave]);
    setMsgSitramNota({ ok: res.success, texto: res.message });
    setConsultandoSitram(false);
    if (res.success) {
      const atualizada = await obterNotaPorId(nota.id);
      if (atualizada) onNotaAtualizada(atualizada);
    }
  }

  const carregarAnexosDaePagamento = useCallback(async () => {
    if (!codigosDaePagamentoChave) {
      setAnexosDaePagamento({});
      return;
    }

    setCarregandoAnexosDaePagamento(true);
    try {
      const res = await listarAnexos(nota.id);
      if (!res.ok) return;

      const anexosPorDae: Record<string, AnexoInfo> = {};
      for (const anexo of res.anexos) {
        if (anexo.mime !== 'text/html') continue;
        const match = anexo.arquivoNome.match(/^dae-sitram-(\d+)\.html$/i);
        if (match?.[1]) anexosPorDae[match[1]] = anexo;
      }
      setAnexosDaePagamento(anexosPorDae);
    } finally {
      setCarregandoAnexosDaePagamento(false);
    }
  }, [codigosDaePagamentoChave, nota.id]);

  useEffect(() => {
    void carregarAnexosDaePagamento();
  }, [carregarAnexosDaePagamento]);

  async function handleConsultarPagamentoIcms() {
    setConsultandoPagamentoIcms(true);
    setMsgPagamentoIcms(null);
    const res = await consultarPagamentoIcmsNota(nota.id);
    setMsgPagamentoIcms({ ok: res.success, texto: res.message });
    setConsultandoPagamentoIcms(false);
    if (res.success) {
      await carregarAnexosDaePagamento();
      const atualizada = await obterNotaPorId(nota.id);
      if (atualizada) onNotaAtualizada(atualizada);
    }
  }

  function BannerManifestar() {
    const jaManifestada = !!nota.manifestadaEm;
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        {jaManifestada ? (
          <p className="text-sm text-amber-800">
            ✓ <strong>Ciência da Operação já registrada</strong> em{' '}
            {new Date(nota.manifestadaEm!).toLocaleDateString('pt-BR')}. A nota continua como RESUMO
            até a SEFAZ liberar o XML completo — clique em <strong>Sincronizar</strong> no CNPJ para
            baixá-lo (pode levar alguns minutos após a manifestação).
          </p>
        ) : (
          <>
            <p className="text-sm text-amber-800">
              Esta nota é um <strong>RESUMO</strong> — a SEFAZ ainda não liberou o XML completo
              (itens e DANFE). Faça a <strong>Ciência da Operação</strong> para destravar.
            </p>
            <button
              onClick={handleManifestar}
              disabled={manifestando}
              className="mt-3 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {manifestando ? 'Manifestando…' : 'Manifestar (Ciência da Operação)'}
            </button>
          </>
        )}
        {msgManifesto && (
          <p className={`mt-3 text-sm ${msgManifesto.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {msgManifesto.texto}
          </p>
        )}
      </div>
    );
  }

  function PainelAtualizarSitramNota() {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-900">
          Ainda nao tenho os itens do SITRAM salvos para esta nota.
        </p>
        <p className="mt-1 text-sm text-amber-800">
          Clique para reconsultar o SITRAM agora. Se o portal retornar os itens, o Espelho SITRAM aparece aqui e em tela de impressao.
        </p>
        <button
          type="button"
          onClick={handleAtualizarSitramNota}
          disabled={consultandoSitram}
          className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {consultandoSitram ? 'Consultando SITRAM...' : 'Atualizar SITRAM desta nota'}
        </button>
        {msgSitramNota && (
          <p className={`mt-3 text-sm ${msgSitramNota.ok ? 'text-emerald-700' : 'text-red-700'}`}>
            {msgSitramNota.texto}
          </p>
        )}
      </div>
    );
  }

  function PainelPagamentoIcms() {
    const documentos = pagamentoIcms.documentos;
    const simulacoes = pagamentoIcms.simulacoes;
    const suspeitasDuplicidade = pagamentoIcms.suspeitasDuplicidade;
    const temResultado = documentos.length > 0 || simulacoes.length > 0 || !!pagamentoIcms.consultadoEm;

    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">Pagamento ICMS / SITRAM</p>
            <h3 className="font-bold text-[var(--ink)]">Consulta de DAE por lançamento</h3>
          </div>
          <button
            type="button"
            onClick={handleConsultarPagamentoIcms}
            disabled={consultandoPagamentoIcms}
            className="ml-auto rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {consultandoPagamentoIcms ? 'Consultando...' : 'Consultar pagamento ICMS'}
          </button>
        </div>

        {msgPagamentoIcms && (
          <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${msgPagamentoIcms.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {msgPagamentoIcms.texto}
          </p>
        )}

        {!temResultado && (
          <p className="text-sm text-[var(--ink-mut)]">
            Clique em consultar para verificar se o DAE ja foi pago, se existe DAE emitido ou se ainda esta apenas em aberto para geracao. Se existir DAE emitido, ele sera salvo automaticamente na aba Anexos.
          </p>
        )}

        {pagamentoIcms.consultadoEm && (
          <p className="mb-3 text-xs text-[var(--ink-mut)]">Ultima consulta: {dataHora(pagamentoIcms.consultadoEm)}</p>
        )}

        {suspeitasDuplicidade.length > 0 && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-sm font-black text-red-800">Possivel pagamento duplicado</p>
              <Badge tone="red">{suspeitasDuplicidade.length} alerta(s)</Badge>
            </div>
            <div className="space-y-2">
              {suspeitasDuplicidade.map((suspeita) => (
                <div key={suspeita.id} className="rounded bg-white/70 p-2 text-xs text-red-900">
                  <p className="font-bold">{suspeita.titulo}</p>
                  <p>{suspeita.detalhe}</p>
                  <p className="mt-1 text-red-700">
                    Lancamento: <span className="font-mono">{suspeita.idLancamentoFront || '-'}</span>
                    {' | '}DAE: <span className="font-mono">{suspeita.codigoDocumento || '-'}</span>
                    {' | '}Esperado: {moeda(suspeita.valorEsperado)}
                    {' | '}Pago: {moeda(suspeita.valorPago)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {documentos.length > 0 && (
          <div className="space-y-2">
            {documentos.map((documento, indice) => {
              const codigoDae = normalizarCodigoDae(documento.codigoDocumento);
              const anexoDae = codigoDae ? anexosDaePagamento[codigoDae] : null;
              const hrefDae = anexoDae ? `/danfe/${nota.chave}/anexo/${anexoDae.id}` : '';

              return (
                <article key={`${documento.idLancamentoFront}-${documento.codigoDocumento ?? indice}`} className={`rounded-lg border p-3 ${documento.pago ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[var(--ink)]">{documento.tipo}</p>
                      <p className="text-xs text-[var(--ink-mut)]">{documento.situacao || 'Situacao nao informada'} {documento.valor ? `| ${documento.valor}` : ''}</p>
                    </div>
                    <Badge tone={documento.pago ? 'green' : 'orange'}>{documento.pago ? 'PAGO' : 'EMITIDO'}</Badge>
                  </div>
                  {documento.codigoDocumento && (
                    <p className="mt-2 text-xs text-[var(--ink-mut)]">
                      Codigo DAE: <span className="font-mono text-[var(--ink)] select-all">{documento.codigoDocumento}</span>
                    </p>
                  )}
                  {(documento.total !== null || documento.valorPago !== null || documento.dataPagamento) && (
                    <p className="mt-1 text-xs text-[var(--ink-mut)]">
                      Total DAE: <strong className="text-[var(--ink)]">{moeda(documento.total)}</strong>
                      {' | '}Valor pago: <strong className="text-[var(--ink)]">{moeda(documento.valorPago)}</strong>
                      {' | '}Pagamento: <strong className="text-[var(--ink)]">{documento.dataPagamento ? dataHora(documento.dataPagamento) : '-'}</strong>
                    </p>
                  )}
                  {(documento.codigoBarras || hrefDae) && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-white/80 p-3">
                      <p className="text-xs font-black uppercase tracking-wide text-amber-900">Boleto / DAE</p>
                      {documento.codigoBarras && (
                        <p className="mt-2 break-all rounded bg-amber-50 p-2 font-mono text-xs text-[var(--ink)] select-all">
                          {formatarLinhaDigitavelDae(documento.codigoBarras)}
                        </p>
                      )}
                      {hrefDae ? (
                        <a
                          href={hrefDae}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-black uppercase text-white hover:opacity-90"
                        >
                          VISUALIZAR
                        </a>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="mt-3 inline-flex rounded-lg border border-[var(--border)] px-4 py-2 text-xs font-black uppercase text-[var(--ink-mut)] opacity-60"
                        >
                          {carregandoAnexosDaePagamento ? 'CARREGANDO' : 'VISUALIZAR'}
                        </button>
                      )}
                    </div>
                  )}
                  {documento.dataValidade && !documento.pago && (
                    <p className="mt-2 text-xs font-medium text-amber-800">Validade: {data(documento.dataValidade)}</p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {documentos.length === 0 && simulacoes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-900">DAE em aberto, ainda sem documento emitido encontrado.</p>
            <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              {simulacoes.map((simulacao, indice) => (
                <div key={indice} className="rounded bg-white/70 p-3">
                  <Campo rotulo="Receita" valor={simulacao.receita || 'DAE SITRAM'} />
                  <Campo rotulo="Valor simulado" valor={moeda(simulacao.total ?? simulacao.icmsDevido)} />
                  <Campo rotulo="Vencimento" valor={simulacao.dataVencimento ? data(simulacao.dataVencimento) : '---'} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  }

  function rotuloAba(a: Aba): string {
    if (a === 'dados') return 'Dados';
    if (a === 'sitram') return 'SITRAM';
    if (a === 'frete') return 'Frete';
    if (a === 'danfe') return ehResumo ? 'Espelho SITRAM' : 'DANFE';
    if (a === 'itens') return !danfe && espelhoSitram ? 'Itens SITRAM' : 'Itens';
    return 'Anexos';
  }

  return (
    <div>
      <div className="mb-4 flex w-full flex-wrap gap-1 rounded-lg bg-[var(--surface-2)] p-1 sm:w-fit">
        {(['dados', 'sitram', 'frete', 'danfe', 'itens', 'anexos'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
              aba === a ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm' : 'text-[var(--ink-mut)] hover:text-[var(--ink)]'
            }`}
          >
            {rotuloAba(a)}
          </button>
        ))}
      </div>

      {aba === 'dados' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
              <h3 className="font-bold text-[var(--ink)]">Nota Fiscal</h3>
              <Badge tone={nota.status === 'COMPLETA' ? 'green' : 'blue'}>{nota.status}</Badge>
              <span className="ml-auto text-sm font-semibold text-[var(--ink-mut)]">
                NF {numeroNotaSistema(nota) || '—'} / Série {serieNotaSistema(nota) || '—'}
              </span>
            </div>
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <Campo rotulo="Valor da NF" valor={moeda(nota.valorTotal)} />
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <Campo rotulo="Valor do frete" valor={nota.valorFrete ? moeda(nota.valorFrete) : 'Sem frete'} />
              </div>
              <div className={`rounded-lg border p-3 ${daeResumoClasse}`}>
                <p className="text-xs font-semibold opacity-80">DAE</p>
                <p className="font-black">{temDaeDetalhe ? 'Sim' : 'Nao'} - {daeResumoTexto}</p>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <Campo rotulo="Transportadora" valor={nota.transportadoraNome || 'Sem transportadora'} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm md:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="Empresa (destinatário)" valor={nota.cnpj.razaoSocial || formatarCnpj(nota.cnpj.cnpj)} />
              <Campo rotulo="Natureza da Operação" valor={nota.naturezaOp || '—'} />
              <Campo rotulo="Data de emissão" valor={dataHora(nota.emitidaEm)} />
              <Campo rotulo="Emitente" valor={nota.emitenteNome || '—'} />
              <Campo rotulo="CNPJ Emitente" valor={formatarCnpj(nota.emitenteCnpj)} />
              <Campo rotulo="IE / UF Emitente" valor={`${nota.emitenteIe || '—'} / ${nota.emitenteUf || '—'}`} />
              <Campo rotulo="Destinatário" valor={nota.destNome || (nota.status === 'RESUMO' ? '(após manifestar)' : '—')} />
              <Campo rotulo="CNPJ Destinatário" valor={formatarCnpj(nota.destCnpj)} />
              <Campo rotulo="Qtd. de Itens" valor={nota.qtdItens != null ? String(nota.qtdItens) : '—'} />
            </div>
          </section>

          {false && nota.sitramConsultadaEm && <ResumoDaeVisual nota={nota} />}
          {false && <PainelPagamentoIcms />}

          <div className="hidden grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="mb-3 border-b border-[var(--border)] pb-3 font-bold text-[var(--ink)]">Transporte</h3>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Campo rotulo="Modalidade do frete" valor={nota.modalidadeFrete || '—'} />
                <Campo rotulo="Valor do frete" valor={moeda(nota.valorFrete)} />
                <Campo rotulo="Transportadora" valor={nota.transportadoraNome || '—'} />
                <Campo rotulo="CNPJ Transportadora" valor={nota.transportadoraCnpj ? formatarCnpj(nota.transportadoraCnpj) : '—'} />
                <Campo rotulo="IE / UF Transportadora" valor={`${nota.transportadoraIe || '—'} / ${nota.transportadoraUf || '—'}`} />
                <Campo rotulo="Município" valor={nota.transportadoraMunicipio || '—'} />
              </div>
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="mb-3 border-b border-[var(--border)] pb-3 font-bold text-[var(--ink)]">Valores da NF</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Campo rotulo="Produtos" valor={moeda(nota.valorProdutos)} />
                <Campo rotulo="ICMS da NF" valor={moeda(nota.valorIcms)} />
                <Campo rotulo="Frete" valor={moeda(nota.valorFrete)} />
                <Campo rotulo="Desconto" valor={moeda(nota.valorDesconto)} />
                <div className="col-span-2 rounded-lg bg-[var(--surface-2)] p-3">
                  <Campo rotulo="Valor total" valor={moeda(nota.valorTotal)} />
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <Campo rotulo="NSU" valor={nota.nsu ? String(Number(nota.nsu)) : '—'} />
              <Campo rotulo="MDF-e SITRAM" valor={nota.sitramChaveManifesto || '—'} />
            </div>
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <p className="mb-1 text-xs text-[var(--ink-mut)]">Chave de Acesso</p>
              <p className="break-all font-mono text-sm tracking-wide text-[var(--ink)] select-all">{nota.chave}</p>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <p className="text-xs text-[var(--ink-mut)] mb-2">Etiquetas (pode marcar mais de uma)</p>
            <div className="flex flex-wrap gap-1.5 max-w-md">
              {ETIQUETAS_PRESET.map((tag) => {
                const ativa = tagsOtimizadas.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleClicarEtiqueta(tag); }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition disabled:opacity-50 ${
                      ativa
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                        : 'bg-[var(--surface)] border-[var(--border-strong)] text-[var(--ink-mut)] hover:border-[var(--border-strong)] hover:bg-[var(--accent-soft)]'
                    }`}
                  >
                    {ativa ? '✓ ' : ''}{tag}
                  </button>
                );
              })}
              {tagsOtimizadas.filter((tag) => !ETIQUETAS_PRESET.includes(tag)).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleClicarEtiqueta(tag); }}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--accent)] bg-[var(--accent)] text-white transition disabled:opacity-50"
                >
                  ✓ {tag}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {aba === 'sitram' && (
        <div className="space-y-4">
          {nota.sitramConsultadaEm || temDaeDetalhe ? <ResumoDaeVisual nota={nota} /> : <PainelAtualizarSitramNota />}
          <PainelPagamentoIcms />
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <Campo rotulo="MDF-e SITRAM" valor={nota.sitramChaveManifesto || '—'} />
              <Campo rotulo="Ultima consulta SITRAM" valor={nota.sitramConsultadaEm ? dataHora(nota.sitramConsultadaEm) : '—'} />
            </div>
          </section>
        </div>
      )}

      {aba === 'frete' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-3 border-b border-[var(--border)] pb-3 font-bold text-[var(--ink)]">Frete / Transporte</h3>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
              <Campo rotulo="Modalidade do frete" valor={nota.modalidadeFrete || '—'} />
              <Campo rotulo="Valor do frete" valor={moeda(nota.valorFrete)} />
              <Campo rotulo="Transportadora" valor={nota.transportadoraNome || '—'} />
              <Campo rotulo="CNPJ Transportadora" valor={nota.transportadoraCnpj ? formatarCnpj(nota.transportadoraCnpj) : '—'} />
              <Campo rotulo="IE / UF Transportadora" valor={`${nota.transportadoraIe || '—'} / ${nota.transportadoraUf || '—'}`} />
              <Campo rotulo="Municipio" valor={nota.transportadoraMunicipio || '—'} />
            </div>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="mb-3 border-b border-[var(--border)] pb-3 font-bold text-[var(--ink)]">Valores da NF</h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Campo rotulo="Produtos" valor={moeda(nota.valorProdutos)} />
              <Campo rotulo="ICMS da NF" valor={moeda(nota.valorIcms)} />
              <Campo rotulo="Frete" valor={moeda(nota.valorFrete)} />
              <Campo rotulo="Desconto" valor={moeda(nota.valorDesconto)} />
              <div className="col-span-2 rounded-lg bg-[var(--surface-2)] p-3">
                <Campo rotulo="Valor total" valor={moeda(nota.valorTotal)} />
              </div>
            </div>
          </section>
        </div>
      )}

      {(aba === 'danfe' || aba === 'itens') && (
        <div className="space-y-3">
          {ehResumo && <BannerManifestar />}
          {!ehResumo && carregando && (
            <p className="text-sm text-[var(--ink-mut)] py-6 text-center">Carregando XML…</p>
          )}
          {!ehResumo && erro && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {erro}
              {espelhoSitram ? ' Mostrando o Espelho SITRAM como alternativa operacional.' : ''}
            </p>
          )}
          {danfe && aba === 'danfe' && (
            <div>
              <div className="flex justify-end gap-4 mb-2">
                <a href={`/danfe/${nota.chave}`} target="_blank" rel="noopener noreferrer"
                  className="text-[var(--accent)] text-sm hover:underline">
                  Abrir DANFE / Ctrl+P ↗
                </a>
              </div>
              <div className="border border-[var(--border)] rounded-xl p-4 bg-[var(--surface)] overflow-x-auto">
                <DanfeView danfe={danfe} espelho={espelhoSitram} />
              </div>
            </div>
          )}
          {!danfe && espelhoSitram && aba === 'danfe' && (
            <div>
              <div className="flex justify-end gap-4 mb-2">
                <a href={`/danfe-sitram/${nota.chave}`} target="_blank" rel="noopener noreferrer"
                  className="text-[var(--accent)] text-sm hover:underline">
                  Abrir Espelho SITRAM / Ctrl+P
                </a>
              </div>
              <div className="border border-[var(--border)] rounded-xl p-4 bg-[var(--surface)] overflow-x-auto">
                <SitramEspelhoView espelho={espelhoSitram} />
              </div>
            </div>
          )}
          {!danfe && !espelhoSitram && !carregando && aba === 'danfe' && <PainelAtualizarSitramNota />}
          {danfe && aba === 'itens' && (
            <div className="space-y-4">
              <ItensView danfe={danfe} espelho={espelhoSitram} />
              {espelhoSitram && <SitramItensView espelho={espelhoSitram} />}
            </div>
          )}
          {!danfe && espelhoSitram && aba === 'itens' && <SitramItensView espelho={espelhoSitram} />}
          {!danfe && !espelhoSitram && !carregando && aba === 'itens' && <PainelAtualizarSitramNota />}
        </div>
      )}

      {aba === 'anexos' && <AnexosView nota={nota} />}
    </div>
  );
}

const ACCEPT_ANEXOS =
  '.pdf,.html,.htm,.jpg,.jpeg,.png,.webp,.heic,.gif,.xlsx,.xls,.csv,application/pdf,text/html,image/*';

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizarCodigoDae(valor: string | null | undefined): string {
  return String(valor ?? '').replace(/\D/g, '');
}

function formatarLinhaDigitavelDae(valor: string | null | undefined): string {
  const digitos = normalizarCodigoDae(valor);
  if (!digitos) return valor ?? '';
  if (digitos.length === 48) return (digitos.match(/.{1,12}/g) ?? [digitos]).join(' ');
  if (digitos.length === 44) return (digitos.match(/.{1,11}/g) ?? [digitos]).join(' ');
  return valor ?? digitos;
}

function iconeAnexo(mime: string): string {
  if (mime === 'text/html') return 'HTML';
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  return '📎';
}

function SeloPago() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute right-[-2.75rem] top-[0.65rem] w-40 rotate-45 select-none bg-emerald-600/90 py-0.5 text-center text-[11px] font-black tracking-widest text-white shadow"
    >
      PAGO
    </span>
  );
}

function AnexosView({ nota }: { nota: NotaComCnpj }) {
  const [anexos, setAnexos] = useState<AnexoInfo[]>([]);
  const [opcoesDae, setOpcoesDae] = useState<DaeCompartilhadoInfo[]>([]);
  const [viewer, setViewer] = useState<{ login: string; admin: boolean } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [escopo, setEscopo] = useState<'nota' | 'dae'>('nota');
  const [daeChave, setDaeChave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [excluindo, setExcluindo] = useState<number | null>(null);

  const lancamentosDaeNota = lancamentosVisiveisDae(extrairResumoDae(nota).lancamentos);
  const daePagoNota = statusDaeEfetivo(nota) === 'PAGO'
    || (lancamentosDaeNota.length > 0 && lancamentosDaeNota.every((l) => l.pago));

  async function recarregar() {
    const res = await listarAnexos(nota.id);
    if (res.ok) {
      setAnexos(res.anexos);
      setOpcoesDae(res.opcoesDae);
      setViewer(res.viewer);
      setDaeChave((atual) => {
        if (atual && res.opcoesDae.some((item) => item.chave === atual)) return atual;
        return res.opcoesDae[0]?.chave ?? '';
      });
      if (res.opcoesDae.length === 0) setEscopo('nota');
    }
    setCarregando(false);
  }

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nota.id]);

  async function handleEnviar(e: React.FormEvent) {
    e.preventDefault();
    if (!arquivo) {
      setMsg({ ok: false, texto: 'Selecione um arquivo.' });
      return;
    }
    if (escopo === 'dae' && !daeChave) {
      setMsg({ ok: false, texto: 'Selecione o DAE que vai receber este anexo compartilhado.' });
      return;
    }
    setEnviando(true);
    setMsg(null);
    const fd = new FormData();
    fd.set('arquivo', arquivo);
    fd.set('nome', nome);
    fd.set('escopo', escopo);
    if (escopo === 'dae') fd.set('daeChave', daeChave);
    const res = await enviarAnexo(nota.id, fd);
    setMsg({ ok: res.success, texto: res.message });
    setEnviando(false);
    if (res.success) {
      setNome('');
      setArquivo(null);
      const input = document.getElementById(`anexo-file-${nota.id}`) as HTMLInputElement | null;
      if (input) input.value = '';
      await recarregar();
    }
  }

  async function handleExcluir(id: number) {
    if (!confirm('Excluir este anexo? Esta ação não pode ser desfeita.')) return;
    setExcluindo(id);
    const res = await excluirAnexo(id);
    setMsg({ ok: res.success, texto: res.message });
    setExcluindo(null);
    if (res.success) await recarregar();
  }

  const podeExcluir = (a: AnexoInfo) =>
    !!viewer && (viewer.admin || a.criadoPor === viewer.login);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="mb-3 border-b border-[var(--border)] pb-3 font-bold text-[var(--ink)]">
          Enviar anexo
        </h3>
        <form onSubmit={handleEnviar} className="space-y-3">
          <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
            <label className="flex items-center gap-2 text-[var(--ink)]">
              <input
                type="radio"
                name={`anexo-escopo-${nota.id}`}
                checked={escopo === 'nota'}
                onChange={() => setEscopo('nota')}
              />
              Anexo só desta NF
            </label>
            <label className={`flex items-center gap-2 ${opcoesDae.length === 0 ? 'text-[var(--ink-mut)]' : 'text-[var(--ink)]'}`}>
              <input
                type="radio"
                name={`anexo-escopo-${nota.id}`}
                checked={escopo === 'dae'}
                onChange={() => opcoesDae.length > 0 && setEscopo('dae')}
                disabled={opcoesDae.length === 0}
              />
              Compartilhar com todas as NF do mesmo DAE
            </label>
            {opcoesDae.length === 0 ? (
              <p className="text-xs text-[var(--ink-mut)]">
                Esta NF ainda não tem DAE do SITRAM identificado para compartilhamento.
              </p>
            ) : escopo === 'dae' ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--ink-mut)]">DAE compartilhado</label>
                <select
                  value={daeChave}
                  onChange={(e) => setDaeChave(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-strong)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
                >
                  {opcoesDae.map((item) => (
                    <option key={item.chave} value={item.chave}>
                      {item.titulo}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
            <label className="mb-1 block text-xs text-[var(--ink-mut)]">Nome / descrição (opcional)</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Comprovante DAE, Foto da NF…"
              className="w-full rounded-lg border border-[var(--border-strong)] px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-[var(--ink-mut)]">Arquivo (PDF, HTML, imagem ou planilha)</label>
            <input
              id={`anexo-file-${nota.id}`}
              type="file"
              accept={ACCEPT_ANEXOS}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-[var(--ink-mut)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent-soft)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--accent)] hover:file:bg-[var(--accent-soft)]"
            />
          </div>
          <button
            type="submit"
            disabled={enviando || (escopo === 'dae' && !daeChave)}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent)] disabled:opacity-50"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
          </div>
        </form>
        {msg && (
          <p className={`mt-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.texto}</p>
        )}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="mb-3 border-b border-[var(--border)] pb-3 font-bold text-[var(--ink)]">
          Anexos ({anexos.length})
        </h3>
        {carregando ? (
          <p className="py-6 text-center text-sm text-[var(--ink-mut)]">Carregando…</p>
        ) : anexos.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ink-mut)]">Nenhum anexo ainda.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {anexos.map((a) => {
              const base = `/danfe/${nota.chave}/anexo/${a.id}`;
              const mostrarSeloPago = a.escopo === 'dae' && daePagoNota;
              return (
                <li key={a.id} className="relative flex flex-wrap items-center gap-3 overflow-hidden py-3">
                  {mostrarSeloPago && <SeloPago />}
                  <span className="text-xl">{iconeAnexo(a.mime)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-[var(--ink)]">{a.nome}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${a.escopo === 'dae' ? 'bg-amber-100 text-amber-800' : 'bg-[var(--surface-2)] text-[var(--ink-mut)]'}`}>
                        {a.escopo === 'dae' ? 'DAE compartilhado' : 'NF'}
                      </span>
                    </div>
                    {a.dae && (
                      <p className="truncate text-xs text-amber-700">{a.dae.titulo}</p>
                    )}
                    <p className="truncate text-xs text-[var(--ink-mut)]">
                      {a.arquivoNome} · {formatarTamanho(a.tamanho)}
                      {a.criadoPor ? ` · ${a.criadoPor}` : ''} ·{' '}
                      {new Date(a.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <a
                    href={base}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-[var(--accent)] hover:underline"
                  >
                    Ver
                  </a>
                  <a
                    href={`${base}?download=1`}
                    className="text-sm font-medium text-emerald-600 hover:underline"
                  >
                    Baixar
                  </a>
                  {podeExcluir(a) && (
                    <button
                      onClick={() => handleExcluir(a.id)}
                      disabled={excluindo === a.id}
                      className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                    >
                      {excluindo === a.id ? 'Excluindo…' : 'Excluir'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ResumoDaeVisual({ nota }: { nota: NotaComCnpj }) {
  const resumo = extrairResumoDae(nota);
  const lancamentosVisiveis = lancamentosVisiveisDae(resumo.lancamentos);
  const status = statusDaeEfetivo(nota);
  const vencidos = lancamentosVisiveis.filter((lancamento) => {
    const dias = diasAteVencimento(lancamento.vencimento);
    return !lancamento.pago && dias !== null && dias < 0;
  });
  const proximos = lancamentosVisiveis.filter((lancamento) => {
    const dias = diasAteVencimento(lancamento.vencimento);
    return !lancamento.pago && dias !== null && dias >= 0 && dias <= 7;
  });

  return (
    <section className={`overflow-hidden rounded-xl border bg-[var(--surface)] ${vencidos.length > 0 ? 'border-red-300' : status === 'EM_ABERTO' ? 'border-amber-300' : 'border-[var(--border)]'}`}>
      {(vencidos.length > 0 || proximos.length > 0) && (
        <div className={`px-4 py-3 text-sm font-bold ${vencidos.length > 0 ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950'}`}>
          {vencidos.length > 0
            ? `ATENÇÃO: ${vencidos.length} DAE(s) vencido(s). O pagamento pode ter multa.`
            : `ATENÇÃO: ${proximos.length} DAE(s) vence(m) nos próximos 7 dias.`}
        </div>
      )}

      <div className="p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">SITRAM / DAE</p>
            <h3 className="text-lg font-black text-[var(--ink)]">NF {numeroNotaSistema(nota) || resumo.numeroNota || '—'} / Série {serieNotaSistema(nota) || '—'} — {resumo.classificacao}</h3>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge tone={resumo.classificacao === 'Sem ST' ? 'gray' : 'indigo'}>{resumo.classificacao}</Badge>
            <Badge tone={status === 'PAGO' ? 'green' : status === 'EM_ABERTO' ? 'red' : toneDaeSitram(status)}>
              {textoDaeSitram(status)}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-xl bg-[var(--surface-2)] p-3 text-sm md:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Documento gerado" valor={dataHora(resumo.documentoGeradoEm)} />
          <Campo rotulo="Passou pelo posto fiscal" valor={dataHora(resumo.passouPostoEm)} />
          <Campo rotulo="Posto fiscal" valor={resumo.postoFiscal || '—'} />
          <Campo rotulo="Ação fiscal" valor={resumo.acaoFiscal || '—'} />
        </div>

        {lancamentosVisiveis.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {lancamentosVisiveis.map((lancamento, indice) => {
              const dias = diasAteVencimento(lancamento.vencimento);
              const vencido = !lancamento.pago && dias !== null && dias < 0;
              const venceHoje = !lancamento.pago && dias === 0;
              const campoImposto = lancamento.tipo === 'ST'
                ? 'Valor ICMS ST'
                : lancamento.tipo === 'ANTECIPACAO'
                  ? 'Valor da antecipação'
                  : 'Valor do imposto';

              return (
                <article key={`${lancamento.codigo ?? 'dae'}-${indice}`} className={`rounded-xl border p-4 ${vencido ? 'border-red-300 bg-red-50' : lancamento.pago ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-300 bg-amber-50/50'}`}>
                  <div className="mb-3 flex items-start gap-2 border-b border-black/5 pb-3">
                    <div className="min-w-0">
                      <p className="font-black text-[var(--ink)]">
                        {lancamento.codigo ? `${lancamento.codigo} — ` : ''}{lancamento.descricao}
                      </p>
                      <p className="text-xs text-[var(--ink-mut)]">{lancamento.situacao || 'Situação não informada'}</p>
                    </div>
                    <Badge tone={lancamento.pago ? 'green' : vencido ? 'red' : 'orange'}>
                      {lancamento.pago ? 'PAGO' : vencido ? 'VENCIDO' : 'A PAGAR'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Campo rotulo={campoImposto} valor={moeda(lancamento.valor)} />
                    <Campo
                      rotulo={lancamento.pago ? 'Valor pago' : 'Valor a pagar'}
                      valor={moeda(lancamento.pago ? lancamento.valorPago : lancamento.valorAberto)}
                    />
                    <Campo rotulo="Valor já pago" valor={moeda(lancamento.valorPago)} />
                    <Campo rotulo="Data de vencimento" valor={lancamento.vencimento ? data(lancamento.vencimento) : '—'} />
                  </div>

                  {!lancamento.pago && dias !== null && (
                    <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${vencido ? 'bg-red-600 text-white' : venceHoje ? 'bg-orange-500 text-white' : dias <= 7 ? 'bg-amber-300 text-amber-950' : 'bg-[var(--surface-2)] text-[var(--ink-mut)]'}`}>
                      {vencido
                        ? `Vencido há ${Math.abs(dias)} dia(s) — verificar multa antes de pagar.`
                        : venceHoje
                          ? 'Vence hoje.'
                          : `Vence em ${dias} dia(s).`}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-mut)]">
            <strong>{resumo.classificacao}</strong> — nenhum lançamento de DAE foi retornado pelo SITRAM.
          </div>
        )}

        {nota.sitramDaeResumo && (
          <details className="mt-4 text-xs text-[var(--ink-mut)]">
            <summary className="cursor-pointer font-medium">Ver texto original do SITRAM</summary>
            <p className="mt-2 rounded-lg bg-[var(--surface-2)] p-3 leading-relaxed">{nota.sitramDaeResumo}</p>
          </details>
        )}
      </div>
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--ink-mut)]">{rotulo}</p>
      <p className="font-medium text-[var(--ink)] break-words">{valor}</p>
    </div>
  );
}
