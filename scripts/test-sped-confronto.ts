import { parsearSpedFiscal, periodoSped, limparCnpjSped } from '../src/lib/sped/parser';
import { executarConfronto, type DadosDanfeCollector } from '../src/lib/sped/confronto/motor';
import type { NotaDanfeCompleta } from '../src/lib/sped/confronto/documentos';

console.log('=== TESTE DO MOTOR DE CONFRONTO SPED FISCAL ===');

// Exemplo de SPED Fiscal com empresa, participantes, produtos, C100, C170, C190, E110
const spedTxt = [
  '|0000|017|0|01012026|31012026|NEWSHOP COMERCIAL LTDA|07123456000189||CE|061234567|2304400|||A|1|',
  '|0001|0|',
  // Participante 1: CNPJ com dígito inválido de propósito para testar R-CAD-01
  '|0150|FORN01|FORNECEDOR TESTE INVALIDO|1058|11111111111111||CE|069999999|2304400||RUA A|100||CENTRO|',
  // Participante 2: Fornecedor regular
  '|0150|FORN02|DISTRIBUIDORA EXEMPLO S/A|1058|23456789000100||SP|123456789012|3550308||AV PAULISTA|1000||BELA VISTA|',
  '|0190|UN|UNIDADE|',
  '|0200|PROD01|PRODUTO EXEMPLO TESTE|||UN|00|84713012|||18.00||',
  // C100: Nota de Entrada emitida por terceiro (FORN02), chave com 44 dígitos
  '|C100|0|1|FORN02|55|00|1|12345|35260123456789000100550010000123451000123456|05012026|06012026|5000,00|0|0,00|0,00|5000,00|0|0,00|0,00|5000,00|900,00|0,00|0,00|0,00|0,00|0,00|0,00|',
  // C170 filho da nota 12345
  '|C170|1|PROD01|PRODUTO EXEMPLO TESTE|10,00000|UN|5000,00|0,00|0|000|1102|UN|5000,00|18,00|900,00|0,00|0,00|0,00|0|0,00|0,00|0,00|01|5000,00|1,65|||82,50|01|5000,00|7,60|||380,00||',
  // C190 consolidação
  '|C190|000|1102|18,00|5000,00|5000,00|900,00|0,00|0,00|0,00|0,00||',
  // E110 apuração ICMS
  '|E100|01012026|31012026|',
  '|E110|0,00|0,00|0,00|0,00|900,00|0,00|0,00|0,00|0,00|0,00|0,00|900,00|0,00|0,00|',
  '|9999|12|',
].join('\r\n');

// 1. Testa Parser
const parsed = parsearSpedFiscal(spedTxt);
console.log('1. Parser SPED Fiscal:');
console.log('   Empresa:', parsed.abertura.nome);
console.log('   CNPJ:', parsed.abertura.cnpj, '-> Limpo:', limparCnpjSped(parsed.abertura.cnpj));
console.log('   UF:', parsed.abertura.uf);
console.log('   Período:', periodoSped(parsed.abertura));
console.log('   Total Participantes:', parsed.participantes.length);
console.log('   Total Produtos:', parsed.produtos.length);
console.log('   Total Notas C100:', parsed.notasFiscais.length);
console.log('   Total Itens C170:', parsed.estatisticas.totalC170);

// 2. Mock dos dados do DanfeCollector para confronto
const notasDanfe = new Map<string, NotaDanfeCompleta>();

// Nota 1: Chave corresponde ao C100, mas valor total no DANFE é 5200.00 (no SPED está 5000.00 -> R-DOC-03)
notasDanfe.set('35260123456789000100550010000123451000123456', {
  chave: '35260123456789000100550010000123451000123456',
  numero: '12345',
  serie: '1',
  emitidaEm: new Date(2026, 0, 5),
  tipoOperacao: 'Entrada',
  naturezaOp: 'COMPRA PARA INDUSTRIALIZACAO',
  emitenteNome: 'DISTRIBUIDORA EXEMPLO S/A',
  emitenteCnpj: '23456789000100',
  emitenteIe: '123456789012',
  emitenteUf: 'SP',
  destNome: 'NEWSHOP COMERCIAL LTDA',
  destCnpj: '07123456000189',
  valorTotal: 5200.0, // DIVERGÊNCIA PROPOSITAL COM SPED (5000.00)
  valorProdutos: 5000.0,
  valorFrete: 200.0,
  valorDesconto: 0.0,
  valorIcms: 900.0,
  status: 'COMPLETA',
  situacaoSefaz: 'AUTORIZADA',
});

// Nota 2: Existe no DanfeCollector mas foi omitida no SPED (R-DOC-01)
notasDanfe.set('35260199999999000100550010000999991000999999', {
  chave: '35260199999999000100550010000999991000999999',
  numero: '99999',
  serie: '1',
  emitidaEm: new Date(2026, 0, 10),
  tipoOperacao: 'Entrada',
  naturezaOp: 'COMPRA MERCADORIA',
  emitenteNome: 'FORNECEDOR ESQUECIDO LTDA',
  emitenteCnpj: '99999999000199',
  emitenteIe: '999999999',
  emitenteUf: 'SP',
  destNome: 'NEWSHOP COMERCIAL LTDA',
  destCnpj: '07123456000189',
  valorTotal: 1500.0,
  valorProdutos: 1500.0,
  valorFrete: 0.0,
  valorDesconto: 0.0,
  valorIcms: 270.0,
  status: 'COMPLETA',
  situacaoSefaz: 'AUTORIZADA',
});

const dados: DadosDanfeCollector = {
  notas: notasDanfe,
  xmlsPorChave: new Map(),
  ufEmpresa: 'CE',
};

// 3. Executa Confronto
const resultado = executarConfronto(parsed, dados);
console.log('\n2. Resultado do Confronto:');
console.log('   Total Divergências:', resultado.resumo.total);
console.log('   Por Severidade:', JSON.stringify(resultado.resumo.porSeveridade));
console.log('   Por Tipo:', JSON.stringify(resultado.resumo.porTipo));
console.log('   Por Regra:', JSON.stringify(resultado.resumo.porRegra));

console.log('\n3. Divergências Detectadas:');
for (const d of resultado.divergencias) {
  console.log(`   [${d.codigoRegra}] ${d.severidade} - ${d.tipo}`);
  console.log(`     Registro: ${d.registroSped} (L.${d.linhaSped}) | Campo: ${d.campo}`);
  console.log(`     SPED: "${d.valorSped}" vs DANFE: "${d.valorDanfe}"`);
  console.log(`     Descrição: ${d.descricao}\n`);
}

console.log('=== TESTE CONCLUÍDO COM SUCESSO ===');
