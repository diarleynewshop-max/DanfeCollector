/**
 * Catálogo das regras do confronto SPED em linguagem simples, para a tela.
 * Cada regra diz o que o alerta significa e o que fazer.
 */

export type GrupoRegra = 'notas' | 'itens' | 'cadastro' | 'apuracao';

export interface RegraCatalogo {
  titulo: string;
  grupo: GrupoRegra;
  significado: string;
  comoCorrigir: string;
}

export const CATALOGO_REGRAS: Record<string, RegraCatalogo> = {
  'R-DOC-01': {
    titulo: 'Nota do SPED sem XML no Proton-e',
    grupo: 'notas',
    significado: 'A nota foi escriturada, mas o XML dela não está na base do Proton-e, então não deu para conferir valores e itens. Não quer dizer que a nota esteja errada.',
    comoCorrigir: 'Importe a nota pela chave (menu de importação). A SEFAZ só entrega pelo sincronismo notas dos últimos ~90 dias.',
  },
  'R-DOC-02': {
    titulo: 'Nota autorizada que não foi escriturada',
    grupo: 'notas',
    significado: 'Existe na SEFAZ uma nota contra a empresa, emitida no mês, que não aparece no SPED.',
    comoCorrigir: 'Verifique se a mercadoria chegou e se a entrada foi lançada no ERP. Se chegou só no mês seguinte, é normal; se foi recusada, confirme o evento de desacordo/cancelamento.',
  },
  'R-DOC-03': {
    titulo: 'Valor total diferente do XML',
    grupo: 'notas',
    significado: 'O valor total escriturado não é o mesmo da nota emitida.',
    comoCorrigir: 'Corrija o lançamento da nota no ERP para bater com o XML e gere o SPED de novo.',
  },
  'R-DOC-04': {
    titulo: 'Valor das mercadorias diferente do XML',
    grupo: 'notas',
    significado: 'O total de produtos escriturado não é o mesmo da nota.',
    comoCorrigir: 'Revise os itens lançados (item faltando, duplicado ou com valor errado).',
  },
  'R-DOC-05': {
    titulo: 'ICMS da nota inconsistente',
    grupo: 'notas',
    significado: 'Em compra: a empresa se creditou de mais ICMS do que o fornecedor destacou. Em nota própria: o ICMS escriturado difere do XML.',
    comoCorrigir: 'Ajuste o crédito/débito de ICMS da nota no ERP. Crédito a maior é autuação certa em fiscalização.',
  },
  'R-DOC-09': {
    titulo: 'Frete diferente do XML',
    grupo: 'notas',
    significado: 'O valor de frete escriturado é diferente do da nota.',
    comoCorrigir: 'Corrija o frete no lançamento da nota.',
  },
  'R-DOC-10': {
    titulo: 'Desconto diferente do XML',
    grupo: 'notas',
    significado: 'O desconto escriturado é diferente do da nota.',
    comoCorrigir: 'Corrija o desconto no lançamento da nota.',
  },
  'R-DOC-11': {
    titulo: 'Data de emissão diferente do XML',
    grupo: 'notas',
    significado: 'A data de emissão lançada não é a mesma da nota.',
    comoCorrigir: 'Corrija a data de emissão no ERP (a data de entrada pode ser diferente, a de emissão não).',
  },
  'R-DOC-12': {
    titulo: 'Nota cancelada escriturada como regular',
    grupo: 'notas',
    significado: 'A nota foi cancelada na SEFAZ, mas está no SPED como válida.',
    comoCorrigir: 'Estorne o lançamento no ERP ou escriture com situação 02 (cancelada).',
  },
  'R-DOC-13': {
    titulo: 'Nota denegada escriturada',
    grupo: 'notas',
    significado: 'A SEFAZ denegou a nota, mas ela está escriturada.',
    comoCorrigir: 'Escriture com situação 04 (denegada) ou remova o lançamento.',
  },
  'R-DOC-14': {
    titulo: 'Entrada/saída invertida',
    grupo: 'notas',
    significado: 'A nota foi lançada como entrada quando é saída para a empresa, ou o contrário.',
    comoCorrigir: 'Corrija o tipo de operação no lançamento.',
  },
  'R-ITEM-00': {
    titulo: 'Itens não conferidos',
    grupo: 'itens',
    significado: 'A quantidade de itens do SPED não é a mesma do XML (o ERP pode ter agrupado itens), então a conferência item a item foi pulada.',
    comoCorrigir: 'Nada obrigatório. Se o agrupamento não foi intencional, revise o lançamento.',
  },
  'R-ITEM-01': {
    titulo: 'CFOP incompatível com a nota',
    grupo: 'itens',
    significado: 'Em compra: o CFOP de entrada não corresponde à origem (ex.: fornecedor de outro estado lançado com CFOP 1xxx). Em nota própria: CFOP diferente do emitido.',
    comoCorrigir: 'Corrija o CFOP do item no ERP (interna = 1xxx, interestadual = 2xxx).',
  },
  'R-ITEM-03': {
    titulo: 'Alíquota de ICMS diferente do XML',
    grupo: 'itens',
    significado: 'Na nota emitida pela empresa, a alíquota escriturada é diferente da emitida.',
    comoCorrigir: 'Corrija a alíquota no ERP.',
  },
  'R-ITEM-04': {
    titulo: 'Base de cálculo do ICMS diferente do XML',
    grupo: 'itens',
    significado: 'Na nota emitida pela empresa, a base escriturada é diferente da emitida.',
    comoCorrigir: 'Corrija a base de cálculo do item no ERP.',
  },
  'R-ITEM-05': {
    titulo: 'ICMS do item inconsistente',
    grupo: 'itens',
    significado: 'Em compra: crédito do item maior que o ICMS destacado. Em nota própria: ICMS diferente do emitido.',
    comoCorrigir: 'Ajuste o ICMS do item no ERP.',
  },
  'R-ITEM-06': {
    titulo: 'NCM do cadastro diferente da nota',
    grupo: 'itens',
    significado: 'O produto está cadastrado no ERP com um NCM, mas o fornecedor informou outro.',
    comoCorrigir: 'Confirme o NCM correto e ajuste o cadastro do produto (registro 0200). NCM errado pode aplicar ST e PIS/COFINS errados.',
  },
  'R-ITEM-07': {
    titulo: 'Quantidade diferente do XML',
    grupo: 'itens',
    significado: 'Na mesma unidade de medida, a quantidade lançada é diferente da nota.',
    comoCorrigir: 'Corrija a quantidade no lançamento (afeta também o estoque).',
  },
  'R-ITEM-08': {
    titulo: 'Valor do item diferente do XML',
    grupo: 'itens',
    significado: 'O valor total do item lançado é diferente do valor na nota.',
    comoCorrigir: 'Corrija o valor do item no lançamento.',
  },
  'R-ITEM-09': {
    titulo: 'Crédito em material de uso e consumo',
    grupo: 'itens',
    significado: 'Item lançado como uso e consumo (CFOP 1556/2556/1407/2407) tomando crédito de ICMS, o que não é permitido.',
    comoCorrigir: 'Zere o crédito de ICMS desses itens no ERP.',
  },
  'R-ITEM-10': {
    titulo: 'ICMS-ST diferente do XML',
    grupo: 'itens',
    significado: 'Na nota emitida pela empresa, o ICMS-ST escriturado é diferente do emitido.',
    comoCorrigir: 'Corrija o ICMS-ST do item no ERP.',
  },
  'R-INT-01': {
    titulo: 'Fornecedor com IE inativa',
    grupo: 'cadastro',
    significado: 'Todas as inscrições estaduais do fornecedor estão inativas, mas ele emitiu notas para a empresa.',
    comoCorrigir: 'Não tome crédito dessas notas e fale com o fornecedor.',
  },
  'R-INT-02': {
    titulo: 'Alíquota errada em operação interestadual',
    grupo: 'itens',
    significado: 'Operação entre estados só admite alíquota de 4%, 7% ou 12%.',
    comoCorrigir: 'Corrija a alíquota do item no ERP.',
  },
  'R-INT-03': {
    titulo: 'Alíquota interestadual em operação interna',
    grupo: 'itens',
    significado: 'Fornecedor do mesmo estado com alíquota típica de operação entre estados. Pode ser legítimo se houver redução de base ou benefício.',
    comoCorrigir: 'Confirme com o contador; se não houver benefício, corrija a alíquota.',
  },
  'R-INT-04': {
    titulo: 'Venda com CFOP de ST sem ST',
    grupo: 'itens',
    significado: 'Saída com CFOP de substituição tributária, mas sem CST de ST.',
    comoCorrigir: 'Revise o CST/CFOP do produto no ERP.',
  },
  'R-INT-05': {
    titulo: 'Crédito de ICMS em compra com ST',
    grupo: 'itens',
    significado: 'Compra de mercadoria sujeita a ST (CFOP x403) lançada com CST de tributação normal e crédito de ICMS. Em regra, quem compra com ST não se credita.',
    comoCorrigir: 'Confirme com o contador. Se não houver regime especial, lance com CST 60 e sem crédito.',
  },
  'R-INT-07': {
    titulo: 'Nota sem itens',
    grupo: 'notas',
    significado: 'NF-e sem itens e sem valor de mercadorias — normalmente nota complementar ou de ajuste.',
    comoCorrigir: 'Só informativo.',
  },
  'R-CAD-02': {
    titulo: 'Nota com participante inexistente',
    grupo: 'cadastro',
    significado: 'A nota aponta para um código de participante que não está no registro 0150. O PVA do SPED rejeita o arquivo.',
    comoCorrigir: 'Gere o SPED de novo no ERP; se persistir, abra chamado com o fornecedor do ERP.',
  },
  'R-CAD-04': {
    titulo: 'IE do fornecedor diferente da nota',
    grupo: 'cadastro',
    significado: 'A inscrição estadual cadastrada no ERP não é a mesma que o fornecedor usou na nota.',
    comoCorrigir: 'Atualize a IE no cadastro do fornecedor.',
  },
  'R-CAD-05': {
    titulo: 'IE do fornecedor inativa ou não encontrada',
    grupo: 'cadastro',
    significado: 'A IE cadastrada não está ativa na consulta oficial.',
    comoCorrigir: 'Confirme a IE com o fornecedor e atualize o cadastro.',
  },
  'R-CAD-06': {
    titulo: 'UF do fornecedor diferente da nota',
    grupo: 'cadastro',
    significado: 'O município cadastrado no ERP é de um estado diferente do que está na nota.',
    comoCorrigir: 'Corrija o município no cadastro do fornecedor.',
  },
  'R-CAD-07': {
    titulo: 'Nome do fornecedor muito diferente',
    grupo: 'cadastro',
    significado: 'A razão social cadastrada é bem diferente da nota — pode ser fornecedor trocado.',
    comoCorrigir: 'Confira se o CNPJ e o nome do cadastro são do mesmo fornecedor.',
  },
  'R-CAD-08': {
    titulo: 'Produto sem NCM válido',
    grupo: 'cadastro',
    significado: 'Produto cadastrado sem NCM ou com NCM que não tem 8 dígitos.',
    comoCorrigir: 'Preencha o NCM correto no cadastro do produto.',
  },
  'R-APUR-00': {
    titulo: 'Apuração não conferida contra as notas',
    grupo: 'apuracao',
    significado: 'O arquivo tem outros documentos com ICMS (cupom, CT-e, energia...) que ainda não são lidos, então o total da apuração não foi comparado com as notas.',
    comoCorrigir: 'Só informativo.',
  },
  'R-APUR-01': {
    titulo: 'Débitos da apuração não batem com as saídas',
    grupo: 'apuracao',
    significado: 'O total de débitos do E110 é diferente da soma do ICMS das notas de saída.',
    comoCorrigir: 'Reprocesse a apuração no ERP antes de gerar o SPED.',
  },
  'R-APUR-02': {
    titulo: 'Créditos da apuração não batem com as entradas',
    grupo: 'apuracao',
    significado: 'O total de créditos do E110 é diferente da soma do ICMS creditado nas notas de entrada.',
    comoCorrigir: 'Reprocesse a apuração no ERP antes de gerar o SPED.',
  },
  'R-APUR-03': {
    titulo: 'Conta da apuração não fecha',
    grupo: 'apuracao',
    significado: 'Saldo devedor, saldo credor ou ICMS a recolher não batem com débitos − créditos.',
    comoCorrigir: 'Reprocesse a apuração no ERP e confira os ajustes (E111).',
  },
  'R-APUR-04': {
    titulo: 'ICMS das saídas diferente dos XMLs',
    grupo: 'apuracao',
    significado: 'O ICMS das saídas escrituradas é diferente do ICMS das notas que a empresa emitiu.',
    comoCorrigir: 'Veja se há nota de saída faltando ou lançada com valor errado.',
  },
};

export function regraCatalogo(codigo: string): RegraCatalogo {
  return CATALOGO_REGRAS[codigo] ?? {
    titulo: codigo,
    grupo: codigo.startsWith('R-CAD') ? 'cadastro' : codigo.startsWith('R-APUR') ? 'apuracao' : codigo.startsWith('R-ITEM') || codigo.startsWith('R-INT') ? 'itens' : 'notas',
    significado: '',
    comoCorrigir: '',
  };
}
