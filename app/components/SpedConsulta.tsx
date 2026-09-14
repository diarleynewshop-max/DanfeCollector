'use client';

import { useState, useRef, useMemo } from 'react';
import type { CnpjOpcaoCte } from './CteConsulta';

interface EmpresaDetectada {
  cnpj: string;
  razaoSocial: string;
  uf: string;
  ie: string;
  periodo: string;
  dtInicio: string;
  dtFim: string;
  layoutVersao: string;
  finalidade: string;
  perfil?: string;
  atividade?: string;
}

interface DivergenciaItem {
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

interface ResumoConfronto {
  total: number;
  porSeveridade: {
    CRITICA: number;
    ALTA: number;
    MEDIA: number;
    BAIXA: number;
    INFO: number;
  };
  porTipo: Record<string, number>;
  porRegra: Record<string, number>;
  topFornecedores: Array<{
    cnpj: string;
    nome: string;
    total: number;
    tipos: string[];
  }>;
}

interface ResultadoConfrontoPayload {
  periodo: string;
  cnpjEmpresa: string;
  nomeEmpresa: string;
  divergencias: DivergenciaItem[];
  resumo: ResumoConfronto;
  estatisticasSped: {
    totalLinhas: number;
    total0150: number;
    total0200: number;
    totalC100: number;
    totalC170: number;
    totalC190: number;
    totalE110: number;
  };
  totalNotasSped: number;
  totalNotasDanfe: number;
  executadoEm: string;
}

interface SpedConsultaProps {
  cnpjs: CnpjOpcaoCte[];
}

function formatarCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return valor || '-';
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function SpedConsulta({ cnpjs }: SpedConsultaProps) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [cnpjSelecionadoId, setCnpjSelecionadoId] = useState<string>('auto');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);

  // Resultados
  const [empresaDetectada, setEmpresaDetectada] = useState<EmpresaDetectada | null>(null);
  const [resultado, setResultado] = useState<ResultadoConfrontoPayload | null>(null);

  // Filtros de visualização
  const [abaCategoria, setAbaCategoria] = useState<'todas' | 'cadastro' | 'documentos' | 'itens' | 'apuracao' | 'fornecedores'>('todas');
  const [filtroSeveridade, setFiltroSeveridade] = useState<string>('TODAS');
  const [buscaTexto, setBuscaTexto] = useState<string>('');
  const [divergenciaDetalhe, setDivergenciaDetalhe] = useState<DivergenciaItem | null>(null);
  const [divergenciasResolvidas, setDivergenciasResolvidas] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleArquivoChange = (file: File | null) => {
    if (!file) return;
    setArquivo(file);
    setErro(null);
    setSucessoMsg(null);
    setResultado(null);
    setEmpresaDetectada(null);
  };

  const executarConfronto = async () => {
    if (!arquivo) {
      setErro('Por favor, selecione um arquivo SPED (.txt).');
      return;
    }

    setProcessando(true);
    setErro(null);
    setSucessoMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', arquivo);
      if (cnpjSelecionadoId !== 'auto') {
        formData.append('cnpjId', cnpjSelecionadoId);
      }

      const res = await fetch('/api/sped/confrontar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha ao processar confronto.');
      }

      setEmpresaDetectada(data.empresaDetectada);
      setResultado(data.resultado);

      // Se a empresa detectada corresponde a uma empresa do banco e estava em 'auto', seleciona
      if (data.empresaVinculada && cnpjSelecionadoId === 'auto') {
        setCnpjSelecionadoId(String(data.empresaVinculada.id));
      }

      setSucessoMsg(
        `Confronto concluído com sucesso! ${data.resultado.divergencias.length} divergências identificadas entre o SPED e o DanfeCollector.`
      );
    } catch (err: any) {
      console.error(err);
      setErro(err.message || 'Ocorreu um erro ao processar o arquivo.');
    } finally {
      setProcessando(false);
    }
  };

  // Filtragem de divergências
  const divergenciasFiltradas = useMemo(() => {
    if (!resultado) return [];

    return resultado.divergencias.filter((d) => {
      // Filtro de aba/categoria
      if (abaCategoria === 'cadastro') {
        if (!d.codigoRegra.startsWith('R-CAD')) return false;
      } else if (abaCategoria === 'documentos') {
        if (!d.codigoRegra.startsWith('R-DOC')) return false;
      } else if (abaCategoria === 'itens') {
        if (!d.codigoRegra.startsWith('R-ITEM')) return false;
      } else if (abaCategoria === 'apuracao') {
        if (!d.codigoRegra.startsWith('R-APUR') && !d.codigoRegra.startsWith('R-INT')) return false;
      }

      // Filtro de severidade
      if (filtroSeveridade !== 'TODAS' && d.severidade !== filtroSeveridade) {
        return false;
      }

      // Filtro de busca de texto
      if (buscaTexto.trim()) {
        const termo = buscaTexto.toLowerCase().trim();
        const bateTexto =
          d.descricao.toLowerCase().includes(termo) ||
          d.codigoRegra.toLowerCase().includes(termo) ||
          d.tipo.toLowerCase().includes(termo) ||
          d.campo.toLowerCase().includes(termo) ||
          (d.chaveNfe && d.chaveNfe.includes(termo)) ||
          (d.fornecedorNome && d.fornecedorNome.toLowerCase().includes(termo)) ||
          (d.fornecedorCnpj && d.fornecedorCnpj.includes(termo)) ||
          (d.registroSped && d.registroSped.toLowerCase().includes(termo));
        if (!bateTexto) return false;
      }

      return true;
    });
  }, [resultado, abaCategoria, filtroSeveridade, buscaTexto]);

  const toggleResolvida = (chaveId: string) => {
    setDivergenciasResolvidas((prev) => {
      const proximo = new Set(prev);
      if (proximo.has(chaveId)) {
        proximo.delete(chaveId);
      } else {
        proximo.add(chaveId);
      }
      return proximo;
    });
  };

  const exportarCsv = () => {
    if (!resultado || resultado.divergencias.length === 0) return;

    const headers = [
      'Severidade',
      'Regra',
      'Tipo',
      'Registro SPED',
      'Linha SPED',
      'Chave NFe',
      'Fornecedor CNPJ',
      'Fornecedor Nome',
      'Campo',
      'Valor no SPED',
      'Valor no DANFE',
      'Descrição',
    ];

    const rows = resultado.divergencias.map((d) => [
      `"${d.severidade}"`,
      `"${d.codigoRegra}"`,
      `"${d.tipo}"`,
      `"${d.registroSped}"`,
      `"${d.linhaSped}"`,
      `"${d.chaveNfe || ''}"`,
      `"${d.fornecedorCnpj || ''}"`,
      `"${(d.fornecedorNome || '').replace(/"/g, '""')}"`,
      `"${d.campo}"`,
      `"${(d.valorSped || '').replace(/"/g, '""')}"`,
      `"${(d.valorDanfe || '').replace(/"/g, '""')}"`,
      `"${(d.descricao || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `confronto_sped_${empresaDetectada?.cnpj || 'export'}_${empresaDetectada?.periodo || ''}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* ── Cabeçalho Principal ── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                Auditoria Fiscal & EFD
              </span>
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                25+ Regras Fiscais Ativas
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[var(--ink)] sm:text-3xl">
              Confronto SPED Fiscal (EFD ICMS/IPI)
            </h1>
            <p className="mt-1 text-sm text-[var(--ink-mut)]">
              Faça o upload do arquivo gerado pelo seu ERP (Varejo Fácil, Domínio, Totvs, etc.) para auditar cadastros errados, notas ausentes, divergências de impostos e apuração com a base de DANFEs.
            </p>
          </div>

          {resultado && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportarCsv}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] px-4 py-2 text-xs font-bold text-[var(--ink)] shadow-sm hover:bg-[var(--border)]"
              >
                📥 Exportar CSV / Excel
              </button>
              <button
                type="button"
                onClick={() => {
                  setResultado(null);
                  setArquivo(null);
                  setEmpresaDetectada(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-300"
              >
                Novo Confronto
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Seção de Upload & Seleção de Empresa ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Dropzone do Arquivo */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm lg:col-span-7">
          <h2 className="text-base font-bold text-[var(--ink)]">1. Selecionar Arquivo SPED (.txt)</h2>
          <p className="mt-0.5 text-xs text-[var(--ink-mut)]">
            Arquivo de texto plano gerado pelo ERP com os blocos 0, C e E da EFD ICMS/IPI.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleArquivoChange(e.dataTransfer.files[0]);
              }
            }}
            className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
              arquivo
                ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                : 'border-[var(--border)] hover:border-blue-400 hover:bg-[var(--surface-hover)]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={(e) => handleArquivoChange(e.target.files?.[0] || null)}
            />

            <div className="rounded-full bg-blue-100 p-3 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              📁
            </div>

            {arquivo ? (
              <div className="mt-3">
                <p className="text-sm font-bold text-[var(--ink)]">{arquivo.name}</p>
                <p className="text-xs text-[var(--ink-mut)]">
                  {(arquivo.size / (1024 * 1024)).toFixed(2)} MB • Clique para trocar de arquivo
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm font-semibold text-[var(--ink)]">
                  Arraste e solte seu SPED Fiscal aqui, ou clique para escolher
                </p>
                <p className="mt-1 text-xs text-[var(--ink-mut)]">
                  Formatos aceitos: .txt da EFD ICMS/IPI (qualquer versão de layout)
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Empresa e Ação */}
        <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm lg:col-span-5">
          <div>
            <h2 className="text-base font-bold text-[var(--ink)]">2. Confirmar Empresa</h2>
            <p className="mt-0.5 text-xs text-[var(--ink-mut)]">
              O SPED identifica a empresa no Registro 0000. Você pode confirmar ou escolher abaixo.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--ink)]">
                  Empresa no DanfeCollector:
                </label>
                <select
                  value={cnpjSelecionadoId}
                  onChange={(e) => setCnpjSelecionadoId(e.target.value)}
                  className="mt-1.5 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--ink)] focus:border-blue-500 focus:outline-none"
                >
                  <option value="auto">⚡ Identificar Automaticamente pelo SPED (Registro 0000)</option>
                  {cnpjs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatarCnpj(c.cnpj)} - {c.razaoSocial || 'Sem Razão Social'}
                    </option>
                  ))}
                </select>
              </div>

              {empresaDetectada && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs dark:border-emerald-900/30 dark:bg-emerald-950/20">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-300">
                    <span>✓</span> Empresa Lida no SPED (Reg. 0000):
                  </div>
                  <div className="mt-1 font-semibold text-[var(--ink)]">
                    {empresaDetectada.razaoSocial}
                  </div>
                  <div className="mt-0.5 text-[var(--ink-mut)]">
                    CNPJ: <span className="font-mono">{formatarCnpj(empresaDetectada.cnpj)}</span> • IE: {empresaDetectada.ie || 'ISENTO'} • UF: {empresaDetectada.uf}
                  </div>
                  <div className="mt-0.5 text-[var(--ink-mut)]">
                    Período: <span className="font-bold text-[var(--ink)]">{empresaDetectada.periodo}</span> ({empresaDetectada.dtInicio} a {empresaDetectada.dtFim}) • Layout {empresaDetectada.layoutVersao}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={executarConfronto}
              disabled={!arquivo || processando}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {processando ? (
                <>
                  <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Processando Auditoria Fiscal...
                </>
              ) : (
                <>🔍 Executar Confronto Fiscal</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Mensagens de Erro e Sucesso ── */}
      {erro && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <strong>Atenção:</strong> {erro}
        </div>
      )}

      {sucessoMsg && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <strong>Sucesso:</strong> {sucessoMsg}
        </div>
      )}

      {/* ── Resultados e Painel de Divergências ── */}
      {resultado && (
        <div className="space-y-6">
          {/* Métricas Principais */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="text-xs font-semibold text-[var(--ink-mut)]">Total Divergências</div>
              <div className="mt-1 text-2xl font-black text-[var(--ink)]">
                {resultado.resumo.total}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ink-mut)]">identificadas</div>
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4 shadow-sm dark:border-red-900/30 dark:bg-red-950/20">
              <div className="text-xs font-semibold text-red-800 dark:text-red-300">Críticas</div>
              <div className="mt-1 text-2xl font-black text-red-600 dark:text-red-400">
                {resultado.resumo.porSeveridade.CRITICA}
              </div>
              <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">Risco fiscal alto</div>
            </div>

            <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-4 shadow-sm dark:border-orange-900/30 dark:bg-orange-950/20">
              <div className="text-xs font-semibold text-orange-800 dark:text-orange-300">Altas</div>
              <div className="mt-1 text-2xl font-black text-orange-600 dark:text-orange-400">
                {resultado.resumo.porSeveridade.ALTA}
              </div>
              <div className="mt-1 text-[11px] text-orange-700 dark:text-orange-300">Valores divergentes</div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/20">
              <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">Médias & Baixas</div>
              <div className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">
                {resultado.resumo.porSeveridade.MEDIA + resultado.resumo.porSeveridade.BAIXA}
              </div>
              <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Ajustes cadastrais</div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="text-xs font-semibold text-[var(--ink-mut)]">Notas no SPED</div>
              <div className="mt-1 text-2xl font-black text-[var(--ink)]">
                {resultado.totalNotasSped}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ink-mut)]">
                Reg. C100 lidos
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm">
              <div className="text-xs font-semibold text-[var(--ink-mut)]">Notas no Danfe</div>
              <div className="mt-1 text-2xl font-black text-[var(--ink)]">
                {resultado.totalNotasDanfe}
              </div>
              <div className="mt-1 text-[11px] text-[var(--ink-mut)]">
                Base SEFAZ no período
              </div>
            </div>
          </div>

          {/* Abas e Barra de Filtros */}
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
              {/* Abas por Categoria */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setAbaCategoria('todas')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    abaCategoria === 'todas'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--surface-hover)] text-[var(--ink-mut)] hover:text-[var(--ink)]'
                  }`}
                >
                  Todas ({resultado.divergencias.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAbaCategoria('cadastro')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    abaCategoria === 'cadastro'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--surface-hover)] text-[var(--ink-mut)] hover:text-[var(--ink)]'
                  }`}
                >
                  🏢 Cadastros 0150/0200
                </button>
                <button
                  type="button"
                  onClick={() => setAbaCategoria('documentos')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    abaCategoria === 'documentos'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--surface-hover)] text-[var(--ink-mut)] hover:text-[var(--ink)]'
                  }`}
                >
                  📄 Documentos C100
                </button>
                <button
                  type="button"
                  onClick={() => setAbaCategoria('itens')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    abaCategoria === 'itens'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--surface-hover)] text-[var(--ink-mut)] hover:text-[var(--ink)]'
                  }`}
                >
                  📦 Itens C170 & Tributos
                </button>
                <button
                  type="button"
                  onClick={() => setAbaCategoria('apuracao')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    abaCategoria === 'apuracao'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--surface-hover)] text-[var(--ink-mut)] hover:text-[var(--ink)]'
                  }`}
                >
                  ⚖️ Apuração & Inteligência
                </button>
                <button
                  type="button"
                  onClick={() => setAbaCategoria('fornecedores')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                    abaCategoria === 'fornecedores'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--surface-hover)] text-[var(--ink-mut)] hover:text-[var(--ink)]'
                  }`}
                >
                  🏭 Top Fornecedores ({resultado.resumo.topFornecedores.length})
                </button>
              </div>

              {/* Filtro de Severidade */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--ink-mut)]">Severidade:</span>
                <select
                  value={filtroSeveridade}
                  onChange={(e) => setFiltroSeveridade(e.target.value)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] focus:outline-none"
                >
                  <option value="TODAS">Todas as Severidades</option>
                  <option value="CRITICA">🔴 Crítica</option>
                  <option value="ALTA">🟠 Alta</option>
                  <option value="MEDIA">🟡 Média</option>
                  <option value="BAIXA">🔵 Baixa</option>
                  <option value="INFO">⚪ Info</option>
                </select>
              </div>
            </div>

            {/* Barra de Busca Rápida */}
            {abaCategoria !== 'fornecedores' && (
              <div className="relative">
                <input
                  type="text"
                  value={buscaTexto}
                  onChange={(e) => setBuscaTexto(e.target.value)}
                  placeholder="Buscar por fornecedor, CNPJ, regra (ex: R-DOC-03), campo ou chave de acesso de 44 dígitos..."
                  className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--ink)] placeholder-[var(--ink-mut)] focus:border-blue-500 focus:outline-none"
                />
                {buscaTexto && (
                  <button
                    onClick={() => setBuscaTexto('')}
                    className="absolute right-3 top-2.5 text-xs text-[var(--ink-mut)] hover:text-[var(--ink)]"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Conteúdo da Aba Fornecedores ── */}
          {abaCategoria === 'fornecedores' && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <h3 className="text-sm font-bold text-[var(--ink)]">
                Ranking de Fornecedores com Maior Volume de Divergências
              </h3>
              <p className="mt-0.5 text-xs text-[var(--ink-mut)]">
                Use esta lista para solicitar cartas de correção ou alinhamento com os setores fiscal e contábil dos emissores.
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--border)] bg-[var(--surface-hover)] text-[var(--ink-mut)]">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Fornecedor</th>
                      <th className="py-2.5 px-3 font-semibold">CNPJ</th>
                      <th className="py-2.5 px-3 font-semibold">Total Divergências</th>
                      <th className="py-2.5 px-3 font-semibold">Tipos Frequentes</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] text-[var(--ink)]">
                    {resultado.resumo.topFornecedores.map((forn, idx) => (
                      <tr key={idx} className="hover:bg-[var(--surface-hover)]">
                        <td className="py-3 px-3 font-bold">{forn.nome}</td>
                        <td className="py-3 px-3 font-mono">{formatarCnpj(forn.cnpj)}</td>
                        <td className="py-3 px-3">
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 dark:bg-red-900/30 dark:text-red-300">
                            {forn.total} divergências
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-wrap gap-1">
                            {forn.tipos.slice(0, 3).map((t, tidx) => (
                              <span
                                key={tidx}
                                className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] text-[var(--ink-mut)]"
                              >
                                {t}
                              </span>
                            ))}
                            {forn.tipos.length > 3 && (
                              <span className="text-[10px] text-[var(--ink-mut)]">
                                +{forn.tipos.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setBuscaTexto(forn.cnpj);
                              setAbaCategoria('todas');
                            }}
                            className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            Filtrar Notas
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tabela de Divergências ── */}
          {abaCategoria !== 'fornecedores' && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--ink)]">
                    Lista Detalhada de Inconsistências ({divergenciasFiltradas.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--ink-mut)]">
                    Clique em qualquer linha para abrir a análise detalhada e orientações de correção.
                  </p>
                </div>
              </div>

              {divergenciasFiltradas.length === 0 ? (
                <div className="py-12 text-center text-xs text-[var(--ink-mut)]">
                  Nenhuma divergência encontrada com os filtros selecionados.
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[var(--border)] bg-[var(--surface-hover)] text-[var(--ink-mut)]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Severidade / Regra</th>
                        <th className="py-2.5 px-3 font-semibold">Registro (Linha)</th>
                        <th className="py-2.5 px-3 font-semibold">Fornecedor / Chave</th>
                        <th className="py-2.5 px-3 font-semibold">Campo</th>
                        <th className="py-2.5 px-3 font-semibold">No SPED</th>
                        <th className="py-2.5 px-3 font-semibold">No DANFE</th>
                        <th className="py-2.5 px-3 font-semibold">Descrição da Divergência</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] text-[var(--ink)]">
                      {divergenciasFiltradas.map((d, index) => {
                        const chaveUnica = `${d.codigoRegra}_${d.linhaSped}_${d.campo}_${index}`;
                        const resolvida = divergenciasResolvidas.has(chaveUnica);

                        let badgeCor = 'bg-gray-100 text-gray-800';
                        if (d.severidade === 'CRITICA') badgeCor = 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300';
                        if (d.severidade === 'ALTA') badgeCor = 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300';
                        if (d.severidade === 'MEDIA') badgeCor = 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
                        if (d.severidade === 'BAIXA') badgeCor = 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';

                        return (
                          <tr
                            key={chaveUnica}
                            className={`hover:bg-[var(--surface-hover)] transition-colors ${
                              resolvida ? 'opacity-40 bg-gray-50/50' : ''
                            }`}
                          >
                            <td className="py-3 px-3">
                              <div className="flex flex-col gap-1">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeCor}`}>
                                  {d.severidade}
                                </span>
                                <span className="font-mono text-[10px] font-semibold text-[var(--ink-mut)]">
                                  {d.codigoRegra}
                                </span>
                              </div>
                            </td>

                            <td className="py-3 px-3 font-mono">
                              <span className="font-bold text-[var(--ink)]">{d.registroSped}</span>
                              <span className="text-[var(--ink-mut)]"> (L.{d.linhaSped})</span>
                            </td>

                            <td className="py-3 px-3 max-w-[220px]">
                              {d.fornecedorNome && (
                                <div className="truncate font-semibold text-[var(--ink)]">
                                  {d.fornecedorNome}
                                </div>
                              )}
                              {d.fornecedorCnpj && (
                                <div className="font-mono text-[10px] text-[var(--ink-mut)]">
                                  {formatarCnpj(d.fornecedorCnpj)}
                                </div>
                              )}
                              {d.chaveNfe && (
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(d.chaveNfe || '');
                                    alert('Chave copiada: ' + d.chaveNfe);
                                  }}
                                  title="Clique para copiar a chave"
                                  className="mt-0.5 cursor-pointer truncate font-mono text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  🔑 {d.chaveNfe.slice(0, 8)}...{d.chaveNfe.slice(-6)}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 font-mono font-semibold text-[var(--ink)]">
                              {d.campo}
                            </td>

                            <td className="py-3 px-3 font-mono text-red-600 dark:text-red-400">
                              {d.valorSped || '—'}
                            </td>

                            <td className="py-3 px-3 font-mono text-emerald-600 dark:text-emerald-400">
                              {d.valorDanfe || '—'}
                            </td>

                            <td className="py-3 px-3 max-w-xs text-[11px] leading-relaxed text-[var(--ink-mut)]">
                              {d.descricao}
                            </td>

                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setDivergenciaDetalhe(d)}
                                  className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
                                >
                                  Ver Detalhes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleResolvida(chaveUnica)}
                                  title={resolvida ? 'Desmarcar como resolvida' : 'Marcar como resolvida'}
                                  className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                                    resolvida
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                                  }`}
                                >
                                  {resolvida ? '✓ Resolvida' : 'Resolver'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Modal de Detalhe da Divergência ── */}
      {divergenciaDetalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                  Regra {divergenciaDetalhe.codigoRegra}
                </span>
                <h3 className="mt-1.5 text-lg font-black text-[var(--ink)]">
                  Detalhe da Inconsistência Fiscal
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDivergenciaDetalhe(null)}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-[var(--surface-hover)]"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-4 space-y-2 text-xs">
              <div>
                <span className="font-semibold text-[var(--ink-mut)]">Tipo de Divergência:</span>{' '}
                <span className="font-bold text-[var(--ink)]">{divergenciaDetalhe.tipo}</span>
              </div>
              <div>
                <span className="font-semibold text-[var(--ink-mut)]">Registro SPED / Linha:</span>{' '}
                <span className="font-mono font-bold text-[var(--ink)]">
                  {divergenciaDetalhe.registroSped} (Linha {divergenciaDetalhe.linhaSped})
                </span>
              </div>
              {divergenciaDetalhe.chaveNfe && (
                <div>
                  <span className="font-semibold text-[var(--ink-mut)]">Chave de Acesso NF-e:</span>{' '}
                  <span className="font-mono text-[var(--ink)]">{divergenciaDetalhe.chaveNfe}</span>
                </div>
              )}
              {divergenciaDetalhe.fornecedorNome && (
                <div>
                  <span className="font-semibold text-[var(--ink-mut)]">Fornecedor:</span>{' '}
                  <span className="font-bold text-[var(--ink)]">
                    {divergenciaDetalhe.fornecedorNome} ({formatarCnpj(divergenciaDetalhe.fornecedorCnpj)})
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl border border-red-200 bg-red-50/50 p-3 dark:border-red-900/30 dark:bg-red-950/20">
                <div className="text-xs font-semibold text-red-800 dark:text-red-300">
                  Valor Constante no SPED
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-red-700 dark:text-red-400">
                  {divergenciaDetalhe.valorSped || '(vazio)'}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/30 dark:bg-emerald-950/20">
                <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Valor Correto no DANFE / SEFAZ
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  {divergenciaDetalhe.valorDanfe || '(vazio)'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs space-y-1">
              <div className="font-bold text-[var(--ink)]">Diagnóstico & Orientação:</div>
              <p className="text-[var(--ink-mut)] leading-relaxed">
                {divergenciaDetalhe.descricao}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDivergenciaDetalhe(null)}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-hover)]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SpedConsulta;
