/**
 * Regras de negocio para validar dados que o ERP (Varejo Facil) retorna para uma
 * nota de compra, comparando com o que deveria ser de acordo com o fornecedor.
 * Adicione novas regras conforme forem identificados casos como o da TECNO.
 */
export interface RegraTipoOperacaoErp {
  fornecedorPadrao: RegExp;
  tiposEsperados: string[];
  descricaoEsperada: string;
}

const REGRAS_TIPO_OPERACAO: RegraTipoOperacaoErp[] = [
  { fornecedorPadrao: /tecno/i, tiposEsperados: ['3', '4'], descricaoEsperada: 'Uso e Consumo' },
];

export interface VerificacaoTipoOperacaoErp {
  divergente: boolean;
  aviso: string | null;
}

export function verificarTipoOperacaoErp(fornecedor: string | null, tipoOperacao: string | null): VerificacaoTipoOperacaoErp {
  if (!fornecedor) return { divergente: false, aviso: null };
  const regra = REGRAS_TIPO_OPERACAO.find((item) => item.fornecedorPadrao.test(fornecedor));
  if (!regra) return { divergente: false, aviso: null };

  const valor = (tipoOperacao ?? '').trim();
  const codigo = valor.match(/^(\d+)/)?.[1];
  const bateComCodigo = codigo ? regra.tiposEsperados.includes(codigo) : false;
  const bateComDescricao = valor.toLowerCase().includes(regra.descricaoEsperada.toLowerCase());
  if (bateComCodigo || bateComDescricao) return { divergente: false, aviso: null };

  return {
    divergente: true,
    aviso: `Tipo de operacao no ERP e "${valor || 'nao informado'}", mas para ${fornecedor} deveria ser ${regra.descricaoEsperada} (${regra.tiposEsperados.join(' ou ')}).`,
  };
}
