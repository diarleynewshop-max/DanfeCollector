'use client';

import { useState, useMemo, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Cnpj, NotaFiscal } from '@prisma/client';
import {
  verificarCertificado,
  sincronizarNotas,
  adicionarCnpj,
  alternarAtivoCnpj,
  removerCnpj,
  obterDetalheNota,
  manifestarNota,
  lerCertificados,
  vincularCertificados,
  importarChavesLote,
  importarXmlsDaPasta,
  alternarEtiqueta,
  manifestarNotasLote,
  listarNotasPorAno,
  atualizarSitramPorChaves,
  listarChavesSitramSemConsulta,
  atualizarTransporteNotasExistentes,
  type ActionResult,
  type CertificadoComStatus,
  type ResultadoImportChave,
  type ResultadoManifestoLote,
  type ResultadoSitramManifesto,
} from '@/lib/actions';
import type { DanfeData } from '@/lib/sefaz/detalhe';
import {
  chaveDataLocal,
  diasAteVencimento,
  extrairResumoDae,
  type DaeCompartilhadoInfo,
  statusDaeEfetivo,
  type LancamentoDaeNormalizado,
} from '@/lib/sitram/dae';
import type { UsuarioLogado } from '@/lib/usuarios/auth';
import { sairUsuario } from '@/lib/usuarios/actions';
import {
  listarAnexos,
  enviarAnexo,
  excluirAnexo,
  type AnexoInfo,
} from '@/lib/anexos/actions';
import DanfeView from './components/DanfeView';
import ItensView from './components/ItensView';

type NotaComCnpj = NotaFiscal & { cnpj: { cnpj: string; razaoSocial: string | null }; situacaoSefaz?: string };
type CnpjComContagem = Cnpj & { _count: { notas: number } };
type FiltroDaeSitram = 'todos' | 'consultado' | 'com-dae' | 'a-pagar' | 'em-aberto' | 'pago' | 'sem-dae' | 'nao-encontrada';

// DAE "a pagar" = DAE em aberto ou ainda a gerar (imposto pendente de pagamento)
const DAE_A_PAGAR = ['EM_ABERTO', 'LIBERADA_PARA_GERAR'];

interface DashboardProps {
  usuario: UsuarioLogado;
  cnpjs: CnpjComContagem[];
  notas: NotaComCnpj[];
  notasAlerta: NotaComCnpj[];
  anosDisponiveis: number[];
  totalNotas: number;
  paginaAtual: number;
  porPagina: number;
}

const CACHE_DANFE_PREFIX = 'danfe-cache:';
const CACHE_DANFE_INDEX = 'danfe-cache:index';
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
    NAO_ENCONTRADA: 'Nao achou',
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

export default function Dashboard({
  usuario,
  cnpjs,
  notas: notasIniciais,
  notasAlerta: notasAlertaIniciais,
  anosDisponiveis,
  totalNotas,
  paginaAtual,
  porPagina,
}: DashboardProps) {
  const router = useRouter();
  const podeAdministrar = usuario.admin;
  const [status, setStatus] = useState<{ success?: boolean; message: string }>({
    message: 'Pronto.',
  });
  // Notas em memória — podem ser substituídas por um ano específico carregado do servidor
  const [notas, setNotas] = useState<NotaComCnpj[]>(notasIniciais);
  const [notasAlerta, setNotasAlerta] = useState<NotaComCnpj[]>(notasAlertaIniciais);
  const [anoCarregado, setAnoCarregado] = useState<number | null>(null);
  const [carregandoAno, setCarregandoAno] = useState(false);

  // Quando o servidor re-renderiza (ex: após sync), atualiza as notas sem limpar filtro de ano
  useEffect(() => {
    if (anoCarregado === null) setNotas(notasIniciais);
  }, [notasIniciais, anoCarregado]);
  useEffect(() => {
    if (anoCarregado === null) setNotasAlerta(notasAlertaIniciais);
  }, [notasAlertaIniciais, anoCarregado]);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [pending, startTransition] = useTransition();

  const [certs, setCerts] = useState<CertificadoComStatus[] | null>(null);
  const [carregandoCerts, setCarregandoCerts] = useState(false);

  // Importação por chave
  const [mostrarImport, setMostrarImport] = useState(false);
  const [importTexto, setImportTexto] = useState('');
  const [importCnpjId, setImportCnpjId] = useState<number | ''>('');
  const [importManifestar, setImportManifestar] = useState(true);
  const [importProgresso, setImportProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [importResumo, setImportResumo] = useState<Record<string, number> | null>(null);
  const [pastaXml, setPastaXml] = useState('');

  // Consulta SITRAM por NF-e ou MDF-e
  const [mostrarSitram, setMostrarSitram] = useState(false);
  const [sitramTexto, setSitramTexto] = useState('');
  const [sitramResultados, setSitramResultados] = useState<ResultadoSitramManifesto[] | null>(null);
  const [sitramAno, setSitramAno] = useState(String(anosDisponiveis[0] ?? new Date().getFullYear()));
  const [sitramConsultandoTudo, setSitramConsultandoTudo] = useState(false);
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

  async function handleSitramTodasSemConsulta() {
    const ano = Number(sitramAno);
    setSitramResultados(null);
    setSitramProgresso(null);
    setSitramConsultandoTudo(true);

    try {
      const pendentes = await listarChavesSitramSemConsulta(
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
        message: `SITRAM ${ano}: ${pendentes.chaves.length} NF-e consultada(s), ${atualizadas} atualizada(s), ${erros} erro(s).`,
      });
      router.refresh();
    } finally {
      setSitramConsultandoTudo(false);
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

  // Filtros avançados
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
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
  const [filtroDaeSitram, setFiltroDaeSitram] = useState<FiltroDaeSitram>('todos');
  const [filtroDaeVencInicio, setFiltroDaeVencInicio] = useState('');
  const [filtroDaeVencFim, setFiltroDaeVencFim] = useState('');
  const [filtroForaCe15SemDae, setFiltroForaCe15SemDae] = useState(false);

  const daePorNota = useMemo(
    () => new Map(notas.map((nota) => [nota.id, extrairResumoDae(nota)])),
    [notas]
  );

  const qtdForaCe15SemDae = useMemo(
    () => notas.filter((nota) => notaForaCeMais15DiasSemDaeOuPagamento(nota)).length,
    [notas]
  );

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
    filtroEmitente,
    filtroDestinatario,
    filtroValorMin,
    filtroValorMax,
    filtroItensMin,
    filtroItensMax,
    filtroDataInicio,
    filtroDataFim,
    filtroMes,
    filtroAno,
    filtroSituacao !== 'todas' ? '1' : '',
    filtroDaeSitram !== 'todos' ? '1' : '',
    filtroDaeVencInicio,
    filtroDaeVencFim,
    filtroForaCe15SemDae ? '1' : '',
    filtroEtiquetas.length > 0 ? '1' : '',
    filtroExcluirEmitentes.length > 0 ? '1' : '',
  ].filter(Boolean).length;
  const usandoPaginacaoServidor =
    anoCarregado === null &&
    filtroCnpjId === 'todos' &&
    filtroStatus === 'todos' &&
    filtrosAtivos === 0;
  const totalPaginasServidor = Math.max(1, Math.ceil(totalNotas / porPagina));

  function limparFiltrosAvancados() {
    setFiltroEmitente('');
    setFiltroDestinatario('');
    setFiltroValorMin('');
    setFiltroValorMax('');
    setFiltroItensMin('');
    setFiltroItensMax('');
    setFiltroDataInicio('');
    setFiltroDataFim('');
    setFiltroMes('');
    setFiltroAnoState('');
    setNotas(notasIniciais);
    setNotasAlerta(notasAlertaIniciais);
    setAnoCarregado(null);
    setFiltroSituacao('todas');
    setFiltroDaeSitram('todos');
    setFiltroDaeVencInicio('');
    setFiltroDaeVencFim('');
    setFiltroForaCe15SemDae(false);
    setFiltroEtiquetas([]);
    setFiltroExcluirEmitentes([]);
    setExcluirEmitenteInput('');
  }

  function filtrarVencimentoDae(inicio: string, fim: string) {
    setFiltroDaeSitram('a-pagar');
    setFiltroDaeVencInicio(inicio);
    setFiltroDaeVencFim(fim);
    setMostrarFiltros(true);
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

  const notasFiltradas = useMemo(() => {
    const emitenteBusca = filtroEmitente.trim().toLowerCase();
    const emitenteBuscaDigitos = filtroEmitente.replace(/\D/g, '');
    const destBusca = filtroDestinatario.trim().toLowerCase();
    const destBuscaDigitos = filtroDestinatario.replace(/\D/g, '');
    const valorMin = filtroValorMin ? Number(filtroValorMin) : null;
    const valorMax = filtroValorMax ? Number(filtroValorMax) : null;
    const itensMin = filtroItensMin ? Number(filtroItensMin) : null;
    const itensMax = filtroItensMax ? Number(filtroItensMax) : null;

    return notas.filter((n) => {
      if (filtroCnpjId !== 'todos' && n.cnpjId !== filtroCnpjId) return false;
      if (filtroStatus !== 'todos' && n.status !== filtroStatus) return false;

      if (emitenteBusca) {
        const nomeAlvo = (n.emitenteNome ?? '').toLowerCase();
        const matchNome = nomeAlvo.length > 0 && (nomeAlvo.includes(emitenteBusca) || emitenteBusca.includes(nomeAlvo));
        const matchCnpj = emitenteBuscaDigitos.length >= 3 && (n.emitenteCnpj ?? '').includes(emitenteBuscaDigitos);
        if (!matchNome && !matchCnpj) return false;
      }
      if (destBusca) {
        const nomeAlvo = (n.destNome ?? '').toLowerCase();
        const matchNome = nomeAlvo.length > 0 && (nomeAlvo.includes(destBusca) || destBusca.includes(nomeAlvo));
        const matchCnpj = destBuscaDigitos.length >= 3 && (n.destCnpj ?? '').includes(destBuscaDigitos);
        if (!matchNome && !matchCnpj) return false;
      }

      const valor = n.valorTotal ?? 0;
      if (valorMin !== null && !Number.isNaN(valorMin) && valor < valorMin) return false;
      if (valorMax !== null && !Number.isNaN(valorMax) && valor > valorMax) return false;

      const qtdItens = n.qtdItens ?? 0;
      if (itensMin !== null && !Number.isNaN(itensMin) && qtdItens < itensMin) return false;
      if (itensMax !== null && !Number.isNaN(itensMax) && qtdItens > itensMax) return false;

      if (filtroEtiquetas.length > 0) {
        const tagsNota = parseEtiquetas(n.etiqueta);
        const corresponde = filtroEtiquetas.some((f) =>
          f === 'sem-etiqueta' ? tagsNota.length === 0 : tagsNota.includes(f)
        );
        if (!corresponde) return false;
      }

      if (filtroExcluirEmitentes.length > 0) {
        const nomeEmit = (n.emitenteNome ?? '').toLowerCase();
        const cnpjEmit = n.emitenteCnpj ?? '';
        const excluida = filtroExcluirEmitentes.some((ex) => {
          const digitos = ex.replace(/\D/g, '');
          if (digitos.length >= 14) return cnpjEmit === digitos.slice(-14);
          const nomeEx = ex.split(/\s[—-]\s/)[0].trim().toLowerCase();
          return nomeEx.length > 0 && nomeEmit.includes(nomeEx);
        });
        if (excluida) return false;
      }

      // Filtros por data de emissão
      const emitidaEm = new Date(n.emitidaEm);
      if (filtroDataInicio && emitidaEm < new Date(filtroDataInicio)) return false;
      if (filtroDataFim && emitidaEm > new Date(filtroDataFim + 'T23:59:59')) return false;
      if (filtroMes && emitidaEm.getMonth() + 1 !== Number(filtroMes)) return false;
      if (filtroAno && emitidaEm.getFullYear() !== Number(filtroAno)) return false;

      // Filtro por situação SEFAZ
      if (filtroSituacao !== 'todas') {
        const situacao = n.situacaoSefaz ?? 'AUTORIZADA';
        if (situacao !== filtroSituacao) return false;
      }

      if (filtroDaeSitram !== 'todos') {
        const dae = statusDaeEfetivo(n);
        const consultada = !!n.sitramConsultadaEm || !!dae;
        const temDae = ['PAGO', 'EM_ABERTO', 'LIBERADA_PARA_GERAR'].includes(dae);
        if (filtroDaeSitram === 'consultado' && !consultada) return false;
        if (filtroDaeSitram === 'com-dae' && !temDae) return false;
        if (filtroDaeSitram === 'a-pagar' && !DAE_A_PAGAR.includes(dae)) return false;
        if (filtroDaeSitram === 'em-aberto' && dae !== 'EM_ABERTO') return false;
        if (filtroDaeSitram === 'pago' && dae !== 'PAGO') return false;
        if (filtroDaeSitram === 'sem-dae' && dae !== 'SEM_DAE') return false;
        if (filtroDaeSitram === 'nao-encontrada' && dae !== 'NAO_ENCONTRADA') return false;
      }

      if (filtroDaeVencInicio || filtroDaeVencFim) {
        const lancamentos = daePorNota.get(n.id)?.lancamentos ?? [];
        const dentroDoIntervalo = lancamentos.some((lancamento) => {
          const vencimento = chaveDataLocal(lancamento.vencimento);
          if (!vencimento) return false;
          if (filtroDaeVencInicio && vencimento < filtroDaeVencInicio) return false;
          if (filtroDaeVencFim && vencimento > filtroDaeVencFim) return false;
          return true;
        });
        if (!dentroDoIntervalo) return false;
      }

      if (filtroForaCe15SemDae && !notaForaCeMais15DiasSemDaeOuPagamento(n)) return false;

      return true;
    });
  }, [
    notas,
    filtroCnpjId,
    filtroStatus,
    filtroEmitente,
    filtroDestinatario,
    filtroValorMin,
    filtroValorMax,
    filtroItensMin,
    filtroItensMax,
    filtroDataInicio,
    filtroDataFim,
    filtroMes,
    filtroAno,
    filtroSituacao,
    filtroDaeSitram,
    filtroDaeVencInicio,
    filtroDaeVencFim,
    daePorNota,
    filtroForaCe15SemDae,
    filtroEtiquetas,
    filtroExcluirEmitentes,
  ]);

  const [paginaCliente, setPaginaCliente] = useState(1);

  useEffect(() => {
    setPaginaCliente(1);
  }, [
    notas,
    filtroCnpjId,
    filtroStatus,
    filtroEmitente,
    filtroDestinatario,
    filtroValorMin,
    filtroValorMax,
    filtroItensMin,
    filtroItensMax,
    filtroDataInicio,
    filtroDataFim,
    filtroMes,
    filtroAno,
    filtroSituacao,
    filtroDaeSitram,
    filtroDaeVencInicio,
    filtroDaeVencFim,
    filtroForaCe15SemDae,
    filtroEtiquetas,
    filtroExcluirEmitentes,
  ]);

  const totalPaginasCliente = Math.max(1, Math.ceil(notasFiltradas.length / porPagina));
  const paginaClienteSegura = Math.min(paginaCliente, totalPaginasCliente);
  const notasVisiveis = useMemo(() => {
    const inicio = (paginaClienteSegura - 1) * porPagina;
    return notasFiltradas.slice(inicio, inicio + porPagina);
  }, [notasFiltradas, paginaClienteSegura, porPagina]);
  const totalFiltrado = useMemo(
    () => notasFiltradas.reduce((acc, n) => acc + (n.valorTotal ?? 0), 0),
    [notasFiltradas]
  );
  const valorGeral = useMemo(() => notas.reduce((a, n) => a + (n.valorTotal ?? 0), 0), [notas]);
  const pendentes = useMemo(
    () => notas.filter((n) => n.status === 'RESUMO' && !n.manifestadaEm).length,
    [notas]
  );

  // Manifestação em lote
  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [manifestoLoteProgresso, setManifestoLoteProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [manifestoLoteResumo, setManifestoLoteResumo] = useState<Record<string, number> | null>(null);
  const [manifestoLoteErros, setManifestoLoteErros] = useState<Array<{ chave: string; detalhe: string }> | null>(null);

  const notasManifestaveis = useMemo(
    () => notasFiltradas.filter((n) => n.status === 'RESUMO' && !n.manifestadaEm),
    [notasFiltradas]
  );

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

  async function handleManifestarLote() {
    const ids = [...selecionadas];
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

  return (
    <div className="min-h-screen p-3 md:p-5 bg-slate-50">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <header className="rounded-xl bg-indigo-700 px-5 py-4 mb-4 shadow-sm flex flex-wrap gap-4 justify-between items-center">
          <div className="flex items-center gap-3 text-white">
            <div className="w-12 h-12 rounded-xl bg-white/15 grid place-items-center text-2xl backdrop-blur">
              🧾
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">DanfeCollector</h1>
              <p className="text-indigo-100 text-sm">Sincronização direta com a SEFAZ · custo zero</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMostrarImport((v) => !v)}
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-lg text-sm font-medium transition backdrop-blur"
            >
              📥 Importar chaves
            </button>
            <button
              onClick={() => setMostrarSitram((v) => !v)}
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-lg text-sm font-medium transition backdrop-blur"
            >
              SITRAM
            </button>
            {podeAdministrar && (
              <>
            <button
              onClick={abrirCertificados}
              disabled={carregandoCerts}
              className="bg-white/15 hover:bg-white/25 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 backdrop-blur"
            >
              {carregandoCerts ? 'Lendo…' : certs ? 'Fechar certificados' : '🔐 Certificados do PC'}
            </button>
            <button
              onClick={() => executar(verificarCertificado)}
              disabled={pending}
              className="bg-white text-indigo-700 hover:bg-indigo-50 px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
            >
              Verificar Certificado
            </button>
              </>
            )}
            <form action={sairUsuario} className="flex items-center gap-2">
              <span className="rounded-lg bg-white/10 px-3 py-2 text-sm text-white">
                {usuario.nome} {usuario.admin ? '(admin)' : '(operacao)'}
              </span>
              <button
                type="submit"
                className="bg-white/15 hover:bg-white/25 text-white px-3 py-2 rounded-lg text-sm font-medium transition"
              >
                Sair
              </button>
            </form>
          </div>
        </header>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <KpiCard label="Empresas" value={String(cnpjs.length)} icon="🏢" accent="bg-indigo-100 text-indigo-700" />
          <KpiCard
            label="Notas fiscais"
            value={anoCarregado ? `${notas.length} (${anoCarregado})` : totalNotas > notas.length ? `${notas.length} de ${totalNotas}` : String(notas.length)}
            icon="🧾"
            accent="bg-sky-100 text-sky-700"
          />
          <KpiCard label="Valor total" value={moeda(valorGeral)} icon="💰" accent="bg-emerald-100 text-emerald-700" />
          <KpiCard label="A manifestar" value={String(pendentes)} icon="⏳" accent="bg-amber-100 text-amber-700" />
        </div>

        {/* Painel de importação por chave */}
        {mostrarImport && (
          <div className="mb-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-800">📥 Importar notas por chave de acesso</h2>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Cole as chaves de acesso (44 dígitos) — pode colar a coluna inteira do Excel. O app
              busca cada nota na SEFAZ pela chave (consulta direta, sem depender do NSU).
            </p>
            <div className="grid md:grid-cols-2 gap-3 mb-3">
              <select
                value={importCnpjId}
                onChange={(e) => setImportCnpjId(e.target.value ? Number(e.target.value) : '')}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="">Empresa destinatária das notas…</option>
                {cnpjs.map((c) => (
                  <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-slate-600">
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
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleImportar}
                disabled={!!importProgresso && importProgresso.feito < importProgresso.total}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {importProgresso && importProgresso.feito < importProgresso.total
                  ? `Importando… ${importProgresso.feito}/${importProgresso.total}`
                  : 'Importar'}
              </button>
              <span className="text-xs text-slate-400">
                {[...new Set(importTexto.match(/\d{44}/g) ?? [])].length} chave(s) detectada(s)
              </span>
            </div>

            {importProgresso && (
              <div className="mt-3">
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-2 transition-all"
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
            <div className="mt-5 pt-4 border-t border-slate-100">
              <p className="text-sm font-medium text-slate-700 mb-1">
                Importar XMLs de uma pasta <span className="text-slate-400 font-normal">(notas antigas / do contador — sem SEFAZ, qualquer data)</span>
              </p>
              <div className="flex gap-2">
                <input
                  value={pastaXml}
                  onChange={(e) => setPastaXml(e.target.value)}
                  placeholder="Ex.: C:\Users\diarl\Documents\XMLs-Contador"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                />
                <button
                  onClick={handleImportarPasta}
                  disabled={pending || !pastaXml}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Importar pasta
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Cada XML é associado à empresa (emitente ou destinatário) já cadastrada. Funciona para qualquer ano.
              </p>
            </div>
            )}
          </div>
        )}

        {mostrarSitram && (
          <div className="mb-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-800">SITRAM por NF-e ou MDF-e</h2>
            </div>
            <p className="text-sm text-slate-500 mb-3">
              Cole chave(s) de NF-e modelo 55 para consultar direto. Chave de MDF-e modelo 58 tambem funciona pelo manifesto.
            </p>
            <textarea
              value={sitramTexto}
              onChange={(e) => setSitramTexto(e.target.value)}
              placeholder="Cole aqui uma ou mais chaves de NF-e ou MDF-e..."
              rows={4}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={handleSitram}
                disabled={pending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {pending ? 'Consultando...' : 'Consultar SITRAM'}
              </button>
              <span className="text-xs text-slate-400">
                {[...new Set(sitramTexto.match(/\d{44}/g) ?? [])].length} chave(s) detectada(s)
              </span>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 grid md:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <p className="text-sm font-medium text-slate-700">Consultar todas as NF sem consulta SITRAM</p>
                <p className="text-xs text-slate-400">
                  Processa automaticamente, uma por uma, todas as NF-e de emitente fora do CE no ano escolhido. Usa a empresa selecionada acima, se houver.
                </p>
                <div className="flex flex-wrap items-center gap-3 mt-2">
                  <label className="text-xs text-slate-500">
                    Ano
                    <select
                      value={sitramAno}
                      onChange={(e) => setSitramAno(e.target.value)}
                      disabled={sitramConsultandoTudo}
                      className="ml-2 border border-slate-300 rounded-lg px-3 py-1 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none disabled:opacity-50"
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
                  onClick={handleSitramTodasSemConsulta}
                  disabled={pending || sitramConsultandoTudo || !sitramAno}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {sitramConsultandoTudo && sitramProgresso
                    ? `Consultando ${sitramProgresso.feito}/${sitramProgresso.total}`
                    : sitramConsultandoTudo
                      ? 'Buscando pendências...'
                      : 'Consultar todas do ano'}
                </button>
                <button
                  onClick={handleAtualizarTransporte}
                  disabled={pending}
                  className="border border-slate-300 text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Atualizar transportadoras
                </button>
              </div>
            </div>
            {sitramProgresso && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-600">
                  <span>{sitramProgresso.feito} de {sitramProgresso.total} consultada(s)</span>
                  <span>{sitramProgresso.atualizadas} atualizada(s) • {sitramProgresso.erros} erro(s)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${sitramProgresso.total ? (sitramProgresso.feito / sitramProgresso.total) * 100 : 0}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-slate-400">A consulta continua sozinha até terminar o ano. Os últimos 100 resultados aparecem abaixo.</p>
              </div>
            )}
            {sitramResultados && (
              <div className="mt-3 space-y-1 text-xs">
                {sitramResultados.map((r) => (
                  <div
                    key={r.chave}
                    className={r.status === 'erro' ? 'text-red-700' : 'text-slate-600'}
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
        {podeAdministrar && certs && (
          <div className="mb-6 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
              <h2 className="text-base font-semibold text-slate-800">🔐 Certificados Digitais no Windows</h2>
              <button
                onClick={handleVincularCerts}
                disabled={pending}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Cadastrar / vincular todas
              </button>
            </div>
            {certs.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">Nenhum e-CNPJ encontrado no repositório do Windows.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-100">
                      <th className="pb-2 font-medium">Empresa</th>
                      <th className="pb-2 font-medium">CNPJ</th>
                      <th className="pb-2 font-medium">UF</th>
                      <th className="pb-2 font-medium">Validade</th>
                      <th className="pb-2 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {certs.map((c) => (
                      <tr key={c.thumbprint} className="hover:bg-slate-50">
                        <td className="py-2.5 font-medium text-slate-700">{c.razaoSocial}</td>
                        <td className="py-2.5 font-mono text-xs text-slate-500">{formatarCnpj(c.cnpj)}</td>
                        <td className="py-2.5">{c.uf}</td>
                        <td className={`py-2.5 ${c.vencido ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
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
            <p className="text-xs text-slate-400 mt-3">
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
                : 'bg-white border-slate-200 text-slate-600'
          }`}
        >
          <span>
            {pending ? '⏳' : status.success === true ? '✅' : status.success === false ? '⚠️' : 'ℹ️'}
          </span>
          <span>{pending ? 'Processando…' : status.message}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Empresas */}
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <h2 className="text-base font-semibold text-slate-800 mb-3 pb-3 border-b border-slate-100">
              Empresas
            </h2>

            {cnpjs.length === 0 && !mostrarForm && (
              <p className="text-sm text-slate-400 py-2">Nenhum CNPJ cadastrado.</p>
            )}

            <ul className="space-y-2">
              {cnpjs.map((c) => {
                const bloqueado = c.bloqueadoAte ? new Date(c.bloqueadoAte) > new Date() : false;
                const hora = c.bloqueadoAte
                  ? new Date(c.bloqueadoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <li key={c.id} className="rounded-xl border border-slate-100 p-3 hover:border-slate-200 hover:bg-slate-50/60 transition">
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-800 truncate">{c.razaoSocial || 'Sem nome'}</p>
                        <p className="text-xs text-slate-500 font-mono">{formatarCnpj(c.cnpj)}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {c.uf} · NSU {Number(c.ultimoNSU)} · {c._count.notas} nota(s)
                        </p>
                      </div>
                      <Badge tone={c.ativo ? 'green' : 'gray'}>{c.ativo ? 'ATIVO' : 'INATIVO'}</Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5 truncate" title={c.situacao}>
                      {c.situacao}
                    </p>
                    <div className="flex gap-3 mt-2 text-xs">
                      <button
                        onClick={() => executar(() => sincronizarNotas(c.id))}
                        disabled={pending || !c.ativo || bloqueado}
                        title={bloqueado ? `Em dia — próxima consulta às ${hora}` : 'Sincronizar com a SEFAZ'}
                        className="font-semibold text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
                      >
                        {bloqueado ? `⏱ Em dia (${hora})` : '↻ Sincronizar'}
                      </button>
                      {podeAdministrar && (
                        <>
                          <button
                            onClick={() => executar(() => alternarAtivoCnpj(c.id))}
                            disabled={pending}
                            className="font-medium text-amber-600 hover:text-amber-700 disabled:opacity-40"
                          >
                            {c.ativo ? 'Desativar' : 'Ativar'}
                          </button>
                          <button
                            onClick={() => executar(() => removerCnpj(c.id))}
                            disabled={pending}
                            className="font-medium text-red-500 hover:text-red-600 disabled:opacity-40"
                          >
                            Remover
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {podeAdministrar && (mostrarForm ? (
              <form action={handleAdicionarCnpj} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <input name="cnpj" placeholder="CNPJ (somente números)" required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                <input name="razaoSocial" placeholder="Razão Social (opcional)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                <input name="uf" placeholder="UF (ex.: CE)" required maxLength={2}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm uppercase bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
                <div className="flex gap-2">
                  <button type="submit" disabled={pending}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                    Salvar
                  </button>
                  <button type="button" onClick={() => setMostrarForm(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-medium">
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setMostrarForm(true)}
                className="mt-4 w-full border border-dashed border-slate-300 text-indigo-600 text-sm font-medium hover:bg-indigo-50 hover:border-indigo-300 rounded-lg py-2 transition">
                + Adicionar CNPJ
              </button>
            ))}
          </div>

          {/* Notas */}
          <div className="lg:col-span-3 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
            <AlertaDaes
              notas={notasAlerta}
              cnpjId={filtroCnpjId}
              onFiltrar={filtrarVencimentoDae}
            />
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-3 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-800 mr-auto">Notas Fiscais</h2>
              <select
                value={filtroCnpjId}
                onChange={(e) => setFiltroCnpjId(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="todos">Todas as empresas</option>
                {cnpjs.map((c) => (
                  <option key={c.id} value={c.id}>{c.razaoSocial || formatarCnpj(c.cnpj)}</option>
                ))}
              </select>
              <select
                value={filtroStatus}
                onChange={(e) => setFiltroStatus(e.target.value as typeof filtroStatus)}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
              >
                <option value="todos">Todos os status</option>
                <option value="RESUMO">Resumo</option>
                <option value="COMPLETA">Completa</option>
              </select>
              <button
                onClick={() => {
                  setFiltroForaCe15SemDae(false);
                  setFiltroDaeSitram((v) => (v === 'a-pagar' ? 'todos' : 'a-pagar'));
                }}
                title="Mostrar só notas com DAE a pagar (em aberto ou a gerar)"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                  filtroDaeSitram === 'a-pagar'
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'border-amber-300 text-amber-700 hover:bg-amber-50'
                }`}
              >
                💰 DAE a pagar
              </button>
              <button
                onClick={alternarFiltroForaCe15SemDae}
                title="Notas completas de emitentes fora do CE, emitidas há mais de 15 dias, sem DAE gerado e sem ICMS pago"
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                  filtroForaCe15SemDae
                    ? 'bg-red-600 border-red-600 text-white'
                    : 'border-red-300 text-red-700 hover:bg-red-50'
                }`}
              >
                Fora do CE +15 dias ({qtdForaCe15SemDae})
              </button>
              <button
                onClick={() => setMostrarFiltros((v) => !v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                  mostrarFiltros || filtrosAtivos > 0
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                🔍 Filtros{filtrosAtivos > 0 ? ` (${filtrosAtivos})` : ''}
              </button>
            </div>

            {mostrarFiltros && (
              <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Emitente (nome ou CNPJ)</label>
                  <input
                    value={filtroEmitente}
                    onChange={(e) => setFiltroEmitente(e.target.value)}
                    placeholder="Buscar emitente…"
                    list="sugestoes-emitente"
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                  />
                  <datalist id="sugestoes-emitente">
                    {sugestoesEmitente.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Destinatário (nome ou CNPJ)</label>
                  <input
                    value={filtroDestinatario}
                    onChange={(e) => setFiltroDestinatario(e.target.value)}
                    placeholder="Buscar destinatário…"
                    list="sugestoes-destinatario"
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                  />
                  <datalist id="sugestoes-destinatario">
                    {sugestoesDestinatario.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Etiqueta</label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => toggleFiltroEtiqueta('sem-etiqueta')}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                        filtroEtiquetas.includes('sem-etiqueta')
                          ? 'bg-indigo-600 border-indigo-600 text-white'
                          : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50'
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
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Valor da NF (R$)</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={filtroValorMin}
                      onChange={(e) => setFiltroValorMin(e.target.value)}
                      placeholder="Mín."
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                    <input
                      type="number"
                      value={filtroValorMax}
                      onChange={(e) => setFiltroValorMax(e.target.value)}
                      placeholder="Máx."
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Qtd. de itens</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={0}
                      value={filtroItensMin}
                      onChange={(e) => setFiltroItensMin(e.target.value)}
                      placeholder="Mín."
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      value={filtroItensMax}
                      onChange={(e) => setFiltroItensMax(e.target.value)}
                      placeholder="Máx."
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">Disponível apenas para notas COMPLETA.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Data de emissão (intervalo)</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={filtroDataInicio}
                      onChange={(e) => setFiltroDataInicio(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                    <input
                      type="date"
                      value={filtroDataFim}
                      onChange={(e) => setFiltroDataFim(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Mês / Ano</label>
                  <div className="flex gap-2">
                    <select
                      value={filtroMes}
                      onChange={(e) => setFiltroMes(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
                    >
                      <option value="">Todos os meses</option>
                      {['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((m, i) => (
                        <option key={i + 1} value={String(i + 1)}>{m}</option>
                      ))}
                    </select>
                    <select
                      value={filtroAno}
                      onChange={(e) => setFiltroAno(e.target.value)}
                      disabled={carregandoAno}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none disabled:opacity-60"
                    >
                      <option value="">Todos (2000 recentes)</option>
                      {anosDisponiveis.map((ano) => (
                        <option key={ano} value={String(ano)}>{ano}{anoCarregado === ano ? ' ✓' : ''}</option>
                      ))}
                    </select>
                    {carregandoAno && <p className="text-xs text-indigo-600 mt-1">Carregando notas de {filtroAno}…</p>}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Situação SEFAZ</label>
                  <select
                    value={filtroSituacao}
                    onChange={(e) => setFiltroSituacao(e.target.value as typeof filtroSituacao)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
                  >
                    <option value="todas">Todas</option>
                    <option value="AUTORIZADA">Autorizada</option>
                    <option value="CANCELADA">Cancelada</option>
                    <option value="DENEGADA">Denegada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">DAE SITRAM</label>
                  <select
                    value={filtroDaeSitram}
                    onChange={(e) => setFiltroDaeSitram(e.target.value as FiltroDaeSitram)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none"
                  >
                    <option value="todos">Todos</option>
                    <option value="consultado">Consultado</option>
                    <option value="com-dae">Com DAE</option>
                    <option value="a-pagar">A pagar (em aberto + gerar)</option>
                    <option value="em-aberto">Em aberto</option>
                    <option value="pago">Pago</option>
                    <option value="sem-dae">Sem DAE</option>
                    <option value="nao-encontrada">Nao encontrada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Vencimento do DAE (intervalo)</label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={filtroDaeVencInicio}
                      onChange={(e) => setFiltroDaeVencInicio(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                    <input
                      type="date"
                      value={filtroDaeVencFim}
                      onChange={(e) => setFiltroDaeVencFim(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Excluir emitente (nome ou CNPJ)</label>
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
                      className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={adicionarExclusaoEmitente}
                      disabled={!excluirEmitenteInput.trim()}
                      className="shrink-0 border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-100 rounded-lg px-3 py-1.5 transition disabled:opacity-40"
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
                <div className="flex items-end">
                  <button
                    onClick={limparFiltrosAvancados}
                    disabled={filtrosAtivos === 0}
                    className="w-full border border-dashed border-slate-300 text-slate-500 text-sm font-medium hover:bg-slate-100 hover:border-slate-400 rounded-lg py-1.5 transition disabled:opacity-40"
                  >
                    Limpar filtros avançados
                  </button>
                </div>
              </div>
            )}

            {!anoCarregado && totalNotas > notas.length && (
              <div className="mb-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-800">
                <span>⚠️</span>
                <span>
                  Exibindo <strong>{notas.length} notas por página</strong> de <strong>{totalNotas} no total</strong>.
                  Sem selecionar <strong>Ano</strong>, a busca e os filtros atuam só nesta página.
                </span>
                <button
                  onClick={() => { setMostrarFiltros(true); }}
                  className="ml-auto shrink-0 bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1 rounded-lg"
                >
                  Abrir filtros
                </button>
              </div>
            )}

            <div className="flex justify-between text-sm text-slate-500 mb-2 px-1">
              <span>
                {notasFiltradas.length} nota(s)
                {anoCarregado ? ` de ${anoCarregado}` : ''}
              </span>
              <span>Total: <strong className="text-slate-800">{moeda(totalFiltrado)}</strong></span>
            </div>

            {notasManifestaveis.length > 0 && (
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
                  disabled={selecionadas.size === 0 || (!!manifestoLoteProgresso && manifestoLoteProgresso.feito < manifestoLoteProgresso.total)}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {manifestoLoteProgresso && manifestoLoteProgresso.feito < manifestoLoteProgresso.total
                    ? `Manifestando… ${manifestoLoteProgresso.feito}/${manifestoLoteProgresso.total}`
                    : `Manifestar selecionadas (${selecionadas.size})`}
                </button>
                {manifestoLoteResumo && (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2 text-xs">
                      {manifestoLoteResumo['manifestada'] ? <Badge tone="green">{manifestoLoteResumo['manifestada']} manifestada(s)</Badge> : null}
                      {manifestoLoteResumo['ja-manifestada'] ? <Badge tone="gray">{manifestoLoteResumo['ja-manifestada']} já manifestada(s)</Badge> : null}
                      {manifestoLoteResumo['completa'] ? <Badge tone="blue">{manifestoLoteResumo['completa']} já completa(s)</Badge> : null}
                      {manifestoLoteResumo['erro'] ? <Badge tone="orange">{manifestoLoteResumo['erro']} erro(s)</Badge> : null}
                    </div>
                    {manifestoLoteErros && manifestoLoteErros.length > 0 && (
                      <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1">
                        <p className="font-semibold text-red-700 mb-1">Detalhes dos erros:</p>
                        {manifestoLoteErros.map((e, i) => (
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

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[56px]" />
                  <col className="w-[130px]" />
                  <col />
                  <col className="w-[150px]" />
                  <col className="w-[240px]" />
                  <col className="w-[220px]" />
                  <col className="w-[160px]" />
                </colgroup>
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide border-b border-slate-200">
                    <th className="px-3 py-2 font-medium"></th>
                    <th className="px-3 py-2 font-medium">NF</th>
                    <th className="px-3 py-2 font-medium">Emitente</th>
                    <th className="px-3 py-2 font-medium text-right">Valores</th>
                    <th className="px-3 py-2 font-medium">Transporte</th>
                    <th className="px-3 py-2 font-medium">SITRAM / DAE</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {notasFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
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
                      selecionavel={n.status === 'RESUMO' && !n.manifestadaEm}
                      selecionada={selecionadas.has(n.id)}
                      onToggleSelecionada={() => toggleSelecionada(n.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
              <span>
                Mostrando {notasFiltradas.length === 0 ? 0 : (paginaClienteSegura - 1) * porPagina + 1}
                {' '}a {Math.min(paginaClienteSegura * porPagina, notasFiltradas.length)} de {notasFiltradas.length}
              </span>
              {usandoPaginacaoServidor ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(paginaAtual <= 2 ? '/' : `/?page=${paginaAtual - 1}`)}
                    disabled={paginaAtual <= 1}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    Página {paginaAtual} de {totalPaginasServidor}
                  </span>
                  <button
                    onClick={() => router.push(`/?page=${paginaAtual + 1}`)}
                    disabled={paginaAtual >= totalPaginasServidor}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              ) : totalPaginasCliente > 1 ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPaginaCliente((p) => Math.max(1, p - 1))}
                    disabled={paginaClienteSegura <= 1}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    Página {paginaClienteSegura} de {totalPaginasCliente}
                  </span>
                  <button
                    onClick={() => setPaginaCliente((p) => Math.min(totalPaginasCliente, p + 1))}
                    disabled={paginaClienteSegura >= totalPaginasCliente}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          DanfeCollector · NF-e direto da SEFAZ
        </p>
      </div>
    </div>
  );
}

function KpiCard({ label, value, icon, accent }: { label: string; value: string; icon: string; accent: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex items-center gap-3">
      <div className={`w-11 h-11 rounded-xl grid place-items-center text-xl ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <p className="text-lg font-bold text-slate-800 truncate">{value}</p>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'green' | 'amber' | 'gray' | 'blue' | 'sky' | 'orange' | 'indigo' | 'red'; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    gray: 'bg-slate-200 text-slate-500',
    blue: 'bg-indigo-100 text-indigo-700',
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

interface ItemAlertaDae {
  id: string;
  nota: NotaComCnpj;
  lancamento: LancamentoDaeNormalizado | null;
  classificacao: string;
  numeroNota: string | null;
  dataChave: string | null;
  dias: number | null;
}

function deslocarData(dias: number): string {
  const valor = new Date();
  valor.setHours(12, 0, 0, 0);
  valor.setDate(valor.getDate() + dias);
  return chaveDataLocal(valor.toISOString()) ?? '';
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
  const itens = useMemo<ItemAlertaDae[]>(() => {
    const resultado: ItemAlertaDae[] = [];

    for (const nota of notas) {
      if (cnpjId !== 'todos' && nota.cnpjId !== cnpjId) continue;
      const status = statusDaeEfetivo(nota);
      if (!DAE_A_PAGAR.includes(status)) continue;

      const resumo = extrairResumoDae(nota);
      const pendentes = resumo.lancamentos.filter((lancamento) => !lancamento.pago);
      if (pendentes.length === 0) {
        resultado.push({
          id: `${nota.id}-sem-data`,
          nota,
          lancamento: null,
          classificacao: resumo.classificacao,
          numeroNota: resumo.numeroNota,
          dataChave: null,
          dias: null,
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
        });
      });
    }

    return resultado.sort((a, b) => {
      if (!a.dataChave) return 1;
      if (!b.dataChave) return -1;
      return a.dataChave.localeCompare(b.dataChave);
    });
  }, [notas, cnpjId]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, ItemAlertaDae[]>();
    for (const item of itens) {
      const chave = item.dataChave ?? 'SEM_DATA';
      const grupo = mapa.get(chave) ?? [];
      grupo.push(item);
      mapa.set(chave, grupo);
    }
    return [...mapa.entries()];
  }, [itens]);

  if (itens.length === 0) return null;

  const vencidos = itens.filter((item) => item.dias !== null && item.dias < 0);
  const vencemHoje = itens.filter((item) => item.dias === 0);
  const proximos = itens.filter((item) => item.dias !== null && item.dias > 0 && item.dias <= 7);
  const totalAberto = itens.reduce((total, item) => total + (item.lancamento?.valorAberto ?? 0), 0);
  const hoje = deslocarData(0);

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50/60">
      <div className="border-b border-amber-200 bg-amber-100/70 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="font-bold text-slate-900">Alerta de DAE a pagar</h2>
            <p className="text-xs text-slate-600">{itens.length} pendência(s) • {moeda(totalAberto)} em aberto</p>
          </div>
          {vencidos.length > 0 && (
            <button
              type="button"
              onClick={() => onFiltrar('', deslocarData(-1))}
              className="rounded-lg border border-red-300 bg-red-600 px-3 py-2 text-left text-white shadow-sm"
            >
              <span className="block text-[10px] font-bold uppercase">Vencidos</span>
              <span className="text-lg font-black">{vencidos.length}</span>
            </button>
          )}
          {vencemHoje.length > 0 && (
            <button
              type="button"
              onClick={() => onFiltrar(hoje, hoje)}
              className="rounded-lg border border-orange-300 bg-orange-500 px-3 py-2 text-left text-white shadow-sm"
            >
              <span className="block text-[10px] font-bold uppercase">Vencem hoje</span>
              <span className="text-lg font-black">{vencemHoje.length}</span>
            </button>
          )}
          {proximos.length > 0 && (
            <button
              type="button"
              onClick={() => onFiltrar(deslocarData(1), deslocarData(7))}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-left text-amber-800 shadow-sm"
            >
              <span className="block text-[10px] font-bold uppercase">Próximos 7 dias</span>
              <span className="text-lg font-black">{proximos.length}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onFiltrar('', '')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm"
          >
            Ver todos
          </button>
        </div>
      </div>

      <div className="max-h-80 divide-y divide-amber-200 overflow-y-auto">
        {grupos.map(([dataGrupo, itensGrupo]) => {
          const diasGrupo = itensGrupo[0]?.dias ?? null;
          const valorGrupo = itensGrupo.reduce((total, item) => total + (item.lancamento?.valorAberto ?? 0), 0);
          const vencido = diasGrupo !== null && diasGrupo < 0;
          const venceHoje = diasGrupo === 0;
          const rotuloPrazo = dataGrupo === 'SEM_DATA'
            ? 'Sem data de vencimento'
            : vencido
              ? `VENCIDO HÁ ${Math.abs(diasGrupo!)} DIA(S)`
              : venceHoje
                ? 'VENCE HOJE'
                : `Vence em ${diasGrupo} dia(s)`;

          return (
            <div key={dataGrupo} className={vencido ? 'bg-red-50' : venceHoje ? 'bg-orange-50' : 'bg-white/70'}>
              <button
                type="button"
                onClick={() => dataGrupo === 'SEM_DATA' ? onFiltrar('', '') : onFiltrar(dataGrupo, dataGrupo)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-2 text-left hover:bg-black/[0.03]"
              >
                <span className="font-bold text-slate-800">
                  {dataGrupo === 'SEM_DATA' ? 'Sem vencimento informado' : data(`${dataGrupo}T12:00:00`)}
                </span>
                <Badge tone={vencido ? 'red' : venceHoje ? 'orange' : 'amber'}>{rotuloPrazo}</Badge>
                <span className="ml-auto text-sm font-bold text-slate-700">
                  {itensGrupo.length} DAE(s) • {moeda(valorGrupo)}
                </span>
              </button>
              <div className="grid gap-2 px-4 pb-3 md:grid-cols-2">
                {itensGrupo.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                    <div className="flex items-center gap-2">
                      <strong className="text-slate-800">NF {item.nota.numero || item.numeroNota || '—'}</strong>
                      <Badge tone="indigo">{item.classificacao}</Badge>
                      <strong className="ml-auto text-slate-800">{moeda(item.lancamento?.valorAberto ?? null)}</strong>
                    </div>
                    <p className="mt-1 truncate text-slate-500" title={item.nota.emitenteNome || ''}>
                      {item.nota.emitenteNome || 'Emitente não informado'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
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
}: {
  nota: NotaComCnpj;
  aberta: boolean;
  onToggle: () => void;
  selecionavel: boolean;
  selecionada: boolean;
  onToggleSelecionada: () => void;
}) {
  const tags = parseEtiquetas(nota.etiqueta);
  const dae = extrairResumoDae(nota);
  const statusDae = statusDaeEfetivo(nota);
  const lancamentoDestaque = dae.lancamentos.find((l) => !l.pago) ?? dae.lancamentos[0];
  const diasParaVencer = diasAteVencimento(lancamentoDestaque?.vencimento);
  return (
    <>
      <tr className={`cursor-pointer transition ${aberta ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`} onClick={onToggle}>
        <td className="px-3 py-3 align-top" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">{aberta ? 'v' : '>'}</span>
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
        <td className="px-3 py-3 align-top">
          <p className="font-medium text-slate-700 whitespace-nowrap">{data(nota.emitidaEm)}</p>
          <p className="text-xs text-slate-400">NF {nota.numero || dae.numeroNota || '-'}</p>
          {nota.tipoOperacao && (
            <div className="mt-1">
              <Badge tone={nota.tipoOperacao === 'Entrada' ? 'sky' : 'orange'}>{nota.tipoOperacao}</Badge>
            </div>
          )}
        </td>
        <td className="px-3 py-3 align-top min-w-0">
          <p className="font-medium text-slate-800 leading-snug line-clamp-2" title={nota.emitenteNome || ''}>
            {nota.emitenteNome || '-'}
          </p>
          <p className="text-xs text-slate-400 font-mono truncate">{formatarCnpj(nota.emitenteCnpj)}</p>
          <p className="text-xs text-slate-400 truncate">{nota.naturezaOp || ''}</p>
        </td>
        <td className="px-3 py-3 align-top text-right">
          <p className="font-semibold text-slate-800 whitespace-nowrap">{moeda(nota.valorTotal)}</p>
          <p className="text-xs text-slate-500 whitespace-nowrap">Frete {moeda(nota.valorFrete)}</p>
          <p className="text-xs text-slate-400">{nota.qtdItens ?? '-'} item(ns)</p>
        </td>
        <td className="px-3 py-3 align-top min-w-0">
          <p className="text-slate-700 truncate" title={nota.transportadoraNome || nota.modalidadeFrete || ''}>
            {nota.transportadoraNome || nota.modalidadeFrete || '-'}
          </p>
          <p className="text-xs text-slate-400 truncate">{nota.modalidadeFrete || '-'}</p>
          {nota.transportadoraCnpj && (
            <p className="text-xs text-slate-400 font-mono truncate">{formatarCnpj(nota.transportadoraCnpj)}</p>
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
              <p className="text-xs font-medium text-slate-600">
                {statusDae === 'PAGO' ? 'Pago' : 'A pagar'}{' '}
                {moeda(statusDae === 'PAGO' ? lancamentoDestaque.valorPago : lancamentoDestaque.valorAberto)}
              </p>
              {lancamentoDestaque.vencimento && (
                <p className={`text-xs ${!lancamentoDestaque.pago && diasParaVencer !== null && diasParaVencer < 0 ? 'font-semibold text-red-600' : 'text-slate-400'}`}>
                  Vence {data(lancamentoDestaque.vencimento)}
                  {!lancamentoDestaque.pago && diasParaVencer !== null && diasParaVencer < 0 ? ' • VENCIDO' : ''}
                </p>
              )}
            </div>
          ) : nota.sitramSituacao && (
            <p className="mt-1 text-xs text-slate-400 truncate" title={nota.sitramSituacao}>{nota.sitramSituacao}</p>
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
        <tr className="bg-slate-50/70">
          <td colSpan={7} className="px-4 py-4">
            <DetalheNota nota={nota} />
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
  const statusDae = statusDaeEfetivo(nota);
  return (
    <>
      <tr className={`cursor-pointer transition ${aberta ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`} onClick={onToggle}>
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
        <td className="py-3 text-slate-400 text-center">{aberta ? '▾' : '▸'}</td>
        <td className="py-3 whitespace-nowrap text-slate-600">{data(nota.emitidaEm)}</td>
        <td className="py-3">
          {nota.tipoOperacao && (
            <Badge tone={nota.tipoOperacao === 'Entrada' ? 'sky' : 'orange'}>{nota.tipoOperacao}</Badge>
          )}
        </td>
        <td className="py-3">
          <p className="font-medium text-slate-800 truncate max-w-[260px]">{nota.emitenteNome || '—'}</p>
          <p className="text-xs text-slate-400 font-mono">{formatarCnpj(nota.emitenteCnpj)}</p>
        </td>
        <td className="py-3 text-right whitespace-nowrap font-semibold text-slate-800">{moeda(nota.valorTotal)}</td>
        <td className="py-3 text-right whitespace-nowrap text-slate-600">{moeda(nota.valorFrete)}</td>
        <td className="py-3">
          {nota.transportadoraNome || nota.modalidadeFrete ? (
            <div className="max-w-[220px]">
              <p className="text-slate-700 truncate" title={nota.transportadoraNome || nota.modalidadeFrete || ''}>
                {nota.transportadoraNome || nota.modalidadeFrete}
              </p>
              {nota.transportadoraCnpj && (
                <p className="text-xs text-slate-400 font-mono">{formatarCnpj(nota.transportadoraCnpj)}</p>
              )}
            </div>
          ) : (
            <span className="text-slate-300">â€”</span>
          )}
        </td>
        <td className="py-3 text-right whitespace-nowrap text-slate-600">{nota.qtdItens ?? '—'}</td>
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
              {nota.sitramSituacao && (
                <span className="text-[11px] text-slate-400 truncate" title={nota.sitramSituacao}>
                  {nota.sitramSituacao}
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
                <span className="text-[11px] text-slate-400 truncate" title={nota.sitramDaeResumo}>
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
        <tr className="bg-slate-50/70">
          <td colSpan={13} className="px-4 py-4">
            <DetalheNota nota={nota} />
          </td>
        </tr>
      )}
    </>
  );
}

type Aba = 'dados' | 'danfe' | 'itens' | 'anexos';

function DetalheNota({ nota }: { nota: NotaComCnpj }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('dados');
  const [danfe, setDanfe] = useState<DanfeData | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [manifestando, setManifestando] = useState(false);
  const [msgManifesto, setMsgManifesto] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvandoEtiqueta, setSalvandoEtiqueta] = useState(false);

  const ehResumo = nota.status === 'RESUMO';
  const tagsAtuais = parseEtiquetas(nota.etiqueta);

  async function handleClicarEtiqueta(tag: string) {
    setSalvandoEtiqueta(true);
    await alternarEtiqueta(nota.id, tag);
    setSalvandoEtiqueta(false);
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
    if (res.success) router.refresh();
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

  return (
    <div>
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
        {(['dados', 'danfe', 'itens', 'anexos'] as Aba[]).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition ${
              aba === a ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {a === 'dados' ? 'Dados' : a === 'danfe' ? 'DANFE' : a === 'itens' ? 'Itens' : 'Anexos'}
          </button>
        ))}
      </div>

      {aba === 'dados' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-800">Nota Fiscal</h3>
              <Badge tone={nota.status === 'COMPLETA' ? 'green' : 'blue'}>{nota.status}</Badge>
              <span className="ml-auto text-sm font-semibold text-slate-600">
                NF {nota.numero || '—'} / Série {nota.serie || '—'}
              </span>
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

          {nota.sitramConsultadaEm && <ResumoDaeVisual nota={nota} />}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 border-b border-slate-100 pb-3 font-bold text-slate-800">Transporte</h3>
              <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                <Campo rotulo="Modalidade do frete" valor={nota.modalidadeFrete || '—'} />
                <Campo rotulo="Valor do frete" valor={moeda(nota.valorFrete)} />
                <Campo rotulo="Transportadora" valor={nota.transportadoraNome || '—'} />
                <Campo rotulo="CNPJ Transportadora" valor={nota.transportadoraCnpj ? formatarCnpj(nota.transportadoraCnpj) : '—'} />
                <Campo rotulo="IE / UF Transportadora" valor={`${nota.transportadoraIe || '—'} / ${nota.transportadoraUf || '—'}`} />
                <Campo rotulo="Município" valor={nota.transportadoraMunicipio || '—'} />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 border-b border-slate-100 pb-3 font-bold text-slate-800">Valores da NF</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Campo rotulo="Produtos" valor={moeda(nota.valorProdutos)} />
                <Campo rotulo="ICMS da NF" valor={moeda(nota.valorIcms)} />
                <Campo rotulo="Frete" valor={moeda(nota.valorFrete)} />
                <Campo rotulo="Desconto" valor={moeda(nota.valorDesconto)} />
                <div className="col-span-2 rounded-lg bg-slate-100 p-3">
                  <Campo rotulo="Valor total" valor={moeda(nota.valorTotal)} />
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <Campo rotulo="NSU" valor={nota.nsu ? String(Number(nota.nsu)) : '—'} />
              <Campo rotulo="MDF-e SITRAM" valor={nota.sitramChaveManifesto || '—'} />
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-1 text-xs text-slate-400">Chave de Acesso</p>
              <p className="break-all font-mono text-sm tracking-wide text-slate-700 select-all">{nota.chave}</p>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-400 mb-2">Etiquetas (pode marcar mais de uma)</p>
            <div className="flex flex-wrap gap-1.5 max-w-md">
              {ETIQUETAS_PRESET.map((tag) => {
                const ativa = tagsAtuais.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleClicarEtiqueta(tag); }}
                    disabled={salvandoEtiqueta}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition disabled:opacity-50 ${
                      ativa
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50'
                    }`}
                  >
                    {ativa ? '✓ ' : ''}{tag}
                  </button>
                );
              })}
              {tagsAtuais.filter((tag) => !ETIQUETAS_PRESET.includes(tag)).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleClicarEtiqueta(tag); }}
                  disabled={salvandoEtiqueta}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-indigo-600 bg-indigo-600 text-white transition disabled:opacity-50"
                >
                  ✓ {tag}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {(aba === 'danfe' || aba === 'itens') && (
        <div>
          {ehResumo && <BannerManifestar />}
          {!ehResumo && carregando && (
            <p className="text-sm text-slate-400 py-6 text-center">Carregando XML…</p>
          )}
          {!ehResumo && erro && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">{erro}</p>
          )}
          {danfe && aba === 'danfe' && (
            <div>
              <div className="flex justify-end gap-4 mb-2">
                <a href={`/danfe/${nota.chave}/pdf`} target="_blank" rel="noopener noreferrer"
                  className="text-emerald-600 text-sm font-medium hover:underline">
                  DANFE oficial (MeuDanfe) ↗
                </a>
                <a href={`/danfe/${nota.chave}`} target="_blank" rel="noopener noreferrer"
                  className="text-indigo-600 text-sm hover:underline">
                  Abrir / Imprimir (PDF) ↗
                </a>
              </div>
              <div className="border border-slate-200 rounded-xl p-4 bg-white overflow-x-auto">
                <DanfeView danfe={danfe} />
              </div>
            </div>
          )}
          {danfe && aba === 'itens' && <ItensView danfe={danfe} />}
        </div>
      )}

      {aba === 'anexos' && <AnexosView nota={nota} />}
    </div>
  );
}

const ACCEPT_ANEXOS =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.xlsx,.xls,.csv,application/pdf,image/*';

function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function iconeAnexo(mime: string): string {
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  return '📎';
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
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 border-b border-slate-100 pb-3 font-bold text-slate-800">
          Enviar anexo
        </h3>
        <form onSubmit={handleEnviar} className="space-y-3">
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <label className="flex items-center gap-2 text-slate-700">
              <input
                type="radio"
                name={`anexo-escopo-${nota.id}`}
                checked={escopo === 'nota'}
                onChange={() => setEscopo('nota')}
              />
              Anexo só desta NF
            </label>
            <label className={`flex items-center gap-2 ${opcoesDae.length === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
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
              <p className="text-xs text-slate-500">
                Esta NF ainda não tem DAE do SITRAM identificado para compartilhamento.
              </p>
            ) : escopo === 'dae' ? (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">DAE compartilhado</label>
                <select
                  value={daeChave}
                  onChange={(e) => setDaeChave(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
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
            <label className="mb-1 block text-xs text-slate-400">Nome / descrição (opcional)</label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Comprovante DAE, Foto da NF…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-slate-400">Arquivo (PDF, imagem ou planilha)</label>
            <input
              id={`anexo-file-${nota.id}`}
              type="file"
              accept={ACCEPT_ANEXOS}
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </div>
          <button
            type="submit"
            disabled={enviando || (escopo === 'dae' && !daeChave)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
          </div>
        </form>
        {msg && (
          <p className={`mt-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.texto}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 border-b border-slate-100 pb-3 font-bold text-slate-800">
          Anexos ({anexos.length})
        </h3>
        {carregando ? (
          <p className="py-6 text-center text-sm text-slate-400">Carregando…</p>
        ) : anexos.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Nenhum anexo ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {anexos.map((a) => {
              const base = `/danfe/${nota.chave}/anexo/${a.id}`;
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="text-xl">{iconeAnexo(a.mime)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium text-slate-700">{a.nome}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${a.escopo === 'dae' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                        {a.escopo === 'dae' ? 'DAE compartilhado' : 'NF'}
                      </span>
                    </div>
                    {a.dae && (
                      <p className="truncate text-xs text-amber-700">{a.dae.titulo}</p>
                    )}
                    <p className="truncate text-xs text-slate-400">
                      {a.arquivoNome} · {formatarTamanho(a.tamanho)}
                      {a.criadoPor ? ` · ${a.criadoPor}` : ''} ·{' '}
                      {new Date(a.createdAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <a
                    href={base}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-indigo-600 hover:underline"
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
  const status = statusDaeEfetivo(nota);
  const vencidos = resumo.lancamentos.filter((lancamento) => {
    const dias = diasAteVencimento(lancamento.vencimento);
    return !lancamento.pago && dias !== null && dias < 0;
  });
  const proximos = resumo.lancamentos.filter((lancamento) => {
    const dias = diasAteVencimento(lancamento.vencimento);
    return !lancamento.pago && dias !== null && dias >= 0 && dias <= 7;
  });

  return (
    <section className={`overflow-hidden rounded-xl border bg-white ${vencidos.length > 0 ? 'border-red-300' : status === 'EM_ABERTO' ? 'border-amber-300' : 'border-slate-200'}`}>
      {(vencidos.length > 0 || proximos.length > 0) && (
        <div className={`px-4 py-3 text-sm font-bold ${vencidos.length > 0 ? 'bg-red-600 text-white' : 'bg-amber-400 text-amber-950'}`}>
          {vencidos.length > 0
            ? `ATENÇÃO: ${vencidos.length} DAE(s) vencido(s). O pagamento pode ter multa.`
            : `ATENÇÃO: ${proximos.length} DAE(s) vence(m) nos próximos 7 dias.`}
        </div>
      )}

      <div className="p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">SITRAM / DAE</p>
            <h3 className="text-lg font-black text-slate-900">NF {nota.numero || resumo.numeroNota || '—'} — {resumo.classificacao}</h3>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Badge tone={resumo.classificacao === 'Sem ST' ? 'gray' : 'indigo'}>{resumo.classificacao}</Badge>
            <Badge tone={status === 'PAGO' ? 'green' : status === 'EM_ABERTO' ? 'red' : toneDaeSitram(status)}>
              {textoDaeSitram(status)}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 text-sm md:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Documento gerado" valor={dataHora(resumo.documentoGeradoEm)} />
          <Campo rotulo="Passou pelo posto fiscal" valor={dataHora(resumo.passouPostoEm)} />
          <Campo rotulo="Posto fiscal" valor={resumo.postoFiscal || '—'} />
          <Campo rotulo="Ação fiscal" valor={resumo.acaoFiscal || '—'} />
        </div>

        {resumo.lancamentos.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {resumo.lancamentos.map((lancamento, indice) => {
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
                      <p className="font-black text-slate-900">
                        {lancamento.codigo ? `${lancamento.codigo} — ` : ''}{lancamento.descricao}
                      </p>
                      <p className="text-xs text-slate-500">{lancamento.situacao || 'Situação não informada'}</p>
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
                    <p className={`mt-3 rounded-lg px-3 py-2 text-xs font-bold ${vencido ? 'bg-red-600 text-white' : venceHoje ? 'bg-orange-500 text-white' : dias <= 7 ? 'bg-amber-300 text-amber-950' : 'bg-slate-100 text-slate-600'}`}>
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
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <strong>{resumo.classificacao}</strong> — nenhum lançamento de DAE foi retornado pelo SITRAM.
          </div>
        )}

        {nota.sitramDaeResumo && (
          <details className="mt-4 text-xs text-slate-500">
            <summary className="cursor-pointer font-medium">Ver texto original do SITRAM</summary>
            <p className="mt-2 rounded-lg bg-slate-50 p-3 leading-relaxed">{nota.sitramDaeResumo}</p>
          </details>
        )}
      </div>
    </section>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{rotulo}</p>
      <p className="font-medium text-slate-700 break-words">{valor}</p>
    </div>
  );
}
