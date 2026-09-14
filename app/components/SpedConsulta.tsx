'use client';

import { useState, useRef } from 'react';
import type { CnpjOpcaoCte } from './CteConsulta';
import SpedResultado, { type ResultadoConfrontoPayload } from './SpedResultado';
import { regraCatalogo } from '@/lib/sped/confronto/catalogo';

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
}

interface SpedConsultaProps {
  cnpjs: CnpjOpcaoCte[];
}

function formatarCnpj(valor: string | null | undefined): string {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length !== 14) return valor || '-';
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatarDataSped(d: string): string {
  const limpo = (d ?? '').replace(/\D/g, '');
  return limpo.length === 8 ? `${limpo.slice(0, 2)}/${limpo.slice(2, 4)}/${limpo.slice(4)}` : d;
}

export function SpedConsulta({ cnpjs }: SpedConsultaProps) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [cnpjSelecionadoId, setCnpjSelecionadoId] = useState<string>('auto');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [empresaDetectada, setEmpresaDetectada] = useState<EmpresaDetectada | null>(null);
  const [resultado, setResultado] = useState<ResultadoConfrontoPayload | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleArquivoChange = (file: File | null) => {
    if (!file) return;
    setArquivo(file);
    setErro(null);
    setResultado(null);
    setEmpresaDetectada(null);
  };

  const novoConfronto = () => {
    setResultado(null);
    setArquivo(null);
    setEmpresaDetectada(null);
    setErro(null);
  };

  const executarConfronto = async () => {
    if (!arquivo) {
      setErro('Selecione um arquivo SPED (.txt).');
      return;
    }

    setProcessando(true);
    setErro(null);

    try {
      const formData = new FormData();
      formData.append('file', arquivo);
      if (cnpjSelecionadoId !== 'auto') {
        formData.append('cnpjId', cnpjSelecionadoId);
      }

      const res = await fetch('/api/sped/confrontar', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha ao processar confronto.');
      }

      setEmpresaDetectada(data.empresaDetectada);
      setResultado(data.resultado);

      if (data.empresaVinculada && cnpjSelecionadoId === 'auto') {
        setCnpjSelecionadoId(String(data.empresaVinculada.id));
      }
    } catch (err: any) {
      console.error(err);
      setErro(err.message || 'Ocorreu um erro ao processar o arquivo.');
    } finally {
      setProcessando(false);
    }
  };

  const exportarCsv = () => {
    if (!resultado || resultado.divergencias.length === 0) return;

    const cel = (v: string | number | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = ['Gravidade', 'Problema', 'Regra', 'NF (chave)', 'Fornecedor', 'CNPJ', 'No SPED', 'Na nota / Proton-e', 'Detalhe', 'O que fazer', 'Linha SPED'];
    const rows = resultado.divergencias.map((d) => {
      const regra = regraCatalogo(d.codigoRegra);
      return [
        d.severidade, regra.titulo, d.codigoRegra, d.chaveNfe, d.fornecedorNome, d.fornecedorCnpj,
        d.valorSped, d.valorDanfe, d.descricao, regra.comoCorrigir, d.linhaSped || '',
      ].map(cel);
    });

    const csvContent = '﻿' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `confronto_sped_${empresaDetectada?.cnpj || 'export'}_${empresaDetectada?.periodo || ''}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[var(--ink)]">Confronto SPED Fiscal</h1>
            <p className="mt-1 text-sm text-[var(--ink-mut)]">
              Envie o SPED (EFD ICMS/IPI) gerado pelo ERP. O Proton-e confere cada nota com o XML da SEFAZ e
              mostra o que está errado e como corrigir.
            </p>
          </div>

          {resultado && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportarCsv}
                className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-xs font-bold text-[var(--ink)] hover:bg-[var(--surface-2)]"
              >
                Exportar planilha
              </button>
              <button
                type="button"
                onClick={novoConfronto}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-bold text-[var(--accent-ink)] hover:brightness-125"
              >
                Novo confronto
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Envio — some depois do resultado para dar espaço ao que importa */}
      {!resultado && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm lg:col-span-7">
            <h2 className="text-sm font-black text-[var(--ink)]">1. Arquivo SPED (.txt)</h2>

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.[0]) handleArquivoChange(e.dataTransfer.files[0]);
              }}
              className={`mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center ${
                arquivo ? 'border-[var(--ink)] bg-[var(--surface-2)]' : 'border-[var(--border-strong)] hover:bg-[var(--surface-2)]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => handleArquivoChange(e.target.files?.[0] || null)}
              />
              {arquivo ? (
                <>
                  <p className="text-sm font-bold text-[var(--ink)]">{arquivo.name}</p>
                  <p className="mt-1 text-xs text-[var(--ink-mut)]">
                    {(arquivo.size / 1024).toFixed(0)} KB · clique para trocar
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[var(--ink)]">Arraste o arquivo aqui ou clique para escolher</p>
                  <p className="mt-1 text-xs text-[var(--ink-mut)]">Arquivo .txt da EFD ICMS/IPI</p>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm lg:col-span-5">
            <div>
              <h2 className="text-sm font-black text-[var(--ink)]">2. Empresa</h2>
              <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[var(--ink-mut)]">
                Empresa no Proton-e
              </label>
              <select
                value={cnpjSelecionadoId}
                onChange={(e) => setCnpjSelecionadoId(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm font-semibold text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--border-strong)]"
              >
                <option value="auto">Identificar pelo CNPJ do arquivo</option>
                {cnpjs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatarCnpj(c.cnpj)} - {c.razaoSocial || 'Sem razão social'}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={executarConfronto}
              disabled={!arquivo || processando}
              className="mt-5 h-11 w-full rounded-lg bg-[var(--accent)] text-sm font-bold text-[var(--accent-ink)] hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {processando ? 'Conferindo notas...' : 'Executar confronto'}
            </button>
          </div>
        </div>
      )}

      {erro && (
        <div className="rounded-xl border border-[var(--crit)] bg-[var(--crit-soft)] p-4 text-sm text-[var(--ink)]">
          <strong className="text-[var(--crit)]">Não foi possível concluir: </strong>
          {erro}
        </div>
      )}

      {resultado && empresaDetectada && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-xs text-[var(--ink-mut)]">
          <span className="font-bold text-[var(--ink)]">{empresaDetectada.razaoSocial}</span>
          <span>CNPJ {formatarCnpj(empresaDetectada.cnpj)}</span>
          <span>IE {empresaDetectada.ie || 'isento'} · {empresaDetectada.uf}</span>
          <span>
            {formatarDataSped(empresaDetectada.dtInicio)} a {formatarDataSped(empresaDetectada.dtFim)}
          </span>
          <span>{empresaDetectada.finalidade}</span>
          {arquivo && <span>Arquivo: {arquivo.name}</span>}
        </div>
      )}

      {resultado && <SpedResultado resultado={resultado} />}
    </div>
  );
}

export default SpedConsulta;
