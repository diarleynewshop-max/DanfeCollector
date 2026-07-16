// Parser da "Relação de Lançamentos de Nota Fiscal" (SITRAM / SEFAZ-CE).
// Extrai, de cada lançamento, o CNPJ do emitente e o número da NF, para
// cruzar com as notas do banco e marcar o DAE como pago.

export interface LancamentoRelacao {
  cnpjEmitente: string; // só dígitos, sem zeros à esquerda
  numeroNota: string;   // só dígitos, sem zeros à esquerda
}

// Normaliza CNPJ/número para comparação (remove zeros à esquerda).
export function normalizarDigitos(valor: string | null | undefined): string {
  const d = String(valor ?? '').replace(/\D/g, '');
  return d ? String(Number(d)) : '';
}

/**
 * Recebe o texto extraído do PDF e devolve os lançamentos (dedup por CNPJ+NF).
 *
 * Cada lançamento no relatório tem o formato (com quebras de linha variáveis):
 *   <CTRC> <CNPJ_EMITENTE> -
 *   <NOME DO EMITENTE ...>
 *   <NUMERO_NF> <dd/mm/aaaa> <dd/mm/aaaa> <TOTAL> <IE_DESTINATARIO> -
 *   ...
 * Ancoramos no CNPJ do emitente (11-14 dígitos) e na "linha da NF"
 * (número + duas datas + valor + IE do destinatário).
 */
export function parseRelacaoPagamentoSitram(texto: string): LancamentoRelacao[] {
  const limpo = texto.replace(/\r/g, '');
  const regex =
    /(\d{11,14})\s*-[\s\S]{0,180}?\b(\d{1,7})\s+\d{2}\/\d{2}\/\d{4}\s+\d{2}\/\d{2}\/\d{4}\s+[\d.]*,\d{2}\s+\d{5,9}\s*-/g;

  const vistos = new Set<string>();
  const resultado: LancamentoRelacao[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(limpo)) !== null) {
    const cnpjEmitente = normalizarDigitos(m[1]);
    const numeroNota = normalizarDigitos(m[2]);
    if (!cnpjEmitente || !numeroNota) continue;
    const chave = `${cnpjEmitente}-${numeroNota}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    resultado.push({ cnpjEmitente, numeroNota });
  }

  const regexDae = /NOTAS\s+FISCAIS\s*:\s*([0-9, .;/|-]+)/gi;
  while ((m = regexDae.exec(limpo)) !== null) {
    const numeros = (m[1].match(/\d{1,9}/g) ?? []).map(normalizarDigitos).filter(Boolean);
    for (const numeroNota of numeros) {
      const chave = `NF-${numeroNota}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      resultado.push({ cnpjEmitente: '', numeroNota });
    }
  }

  return resultado;
}

// Chave de cruzamento com as notas do banco.
export function chaveCruzamento(cnpjEmitente: string | null, numero: string | null): string {
  return `${normalizarDigitos(cnpjEmitente)}-${normalizarDigitos(numero)}`;
}

/**
 * Extrai CNPJ do emitente e número da NF da própria chave de acesso (44 díg.).
 * Funciona mesmo em notas RESUMO (que não têm o campo `numero` preenchido).
 * Layout NF-e: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
 */
export function extrairDaChave(chave: string | null | undefined): { cnpj: string; numero: string } | null {
  const c = String(chave ?? '').replace(/\D/g, '');
  if (c.length !== 44) return null;
  return {
    cnpj: normalizarDigitos(c.slice(6, 20)),
    numero: normalizarDigitos(c.slice(25, 34)),
  };
}
