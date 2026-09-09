import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';

const arquivos = [
  {
    empresa: 'SOYE',
    arquivo: 'C:/Users/diarl/Downloads/SELAGEM SOYE URGENTE.xlsx',
  },
  {
    empresa: 'FACIL MATRIZ',
    arquivo: 'C:/Users/diarl/Downloads/SELAGEM FACIL MATRIZ URGENTE.xlsx',
  },
  {
    empresa: 'FACIL FILIAL',
    arquivo: 'C:/Users/diarl/Downloads/SELAGEM FACIL FILIAL URGENTE.xlsx',
  },
];

function carregarEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  const linhas = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const linha of linhas) {
    const m = linha.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const chave = m[1];
    let valor = m[2].trim();
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[chave]) process.env[chave] = valor;
  }
}

function normalizarChave(valor) {
  const texto = String(valor ?? '').replace(/\D/g, '');
  return texto.length === 44 ? texto : '';
}

function textoCelula(cell) {
  if (!cell) return '';
  if (cell.text) return String(cell.text).trim();
  const valor = cell.value;
  if (valor && typeof valor === 'object' && 'text' in valor) return String(valor.text ?? '').trim();
  return String(valor ?? '').trim();
}

async function lerPlanilhas() {
  const linhas = [];
  for (const cfg of arquivos) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(cfg.arquivo);
    for (const ws of wb.worksheets) {
      const headers = [];
      ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col] = textoCelula(cell);
      });
      const idx = {
        emitenteCnpj: headers.findIndex((h) => /cnpj emitente/i.test(h)),
        cgf: headers.findIndex((h) => /cgf/i.test(h)),
        chave: headers.findIndex((h) => /chave/i.test(h)),
        numero: headers.findIndex((h) => /n[uú]mero/i.test(h)),
        emissao: headers.findIndex((h) => /emiss/i.test(h)),
        valor: headers.findIndex((h) => /valor/i.test(h)),
      };
      for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber += 1) {
        const row = ws.getRow(rowNumber);
        const chave = normalizarChave(textoCelula(row.getCell(idx.chave)));
        if (!chave) continue;
        linhas.push({
          empresaPlanilha: cfg.empresa,
          arquivo: path.basename(cfg.arquivo),
          aba: ws.name,
          linha: rowNumber,
          emitenteCnpjPlanilha: textoCelula(row.getCell(idx.emitenteCnpj)),
          cgfPlanilha: textoCelula(row.getCell(idx.cgf)),
          chave,
          numeroPlanilha: textoCelula(row.getCell(idx.numero)),
          emissaoPlanilha: textoCelula(row.getCell(idx.emissao)),
          valorPlanilha: textoCelula(row.getCell(idx.valor)),
        });
      }
    }
  }
  return linhas;
}

function parseJsonSeguro(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function coletarItens(detalhe) {
  if (!detalhe || typeof detalhe !== 'object') return [];
  if (Array.isArray(detalhe.itens)) return detalhe.itens;
  if (detalhe.itens && Array.isArray(detalhe.itens.content)) return detalhe.itens.content;
  if (detalhe.notaFiscal && Array.isArray(detalhe.notaFiscal.itens)) return detalhe.notaFiscal.itens;
  return [];
}

function primeiroTexto(...valores) {
  for (const valor of valores) {
    if (valor === null || valor === undefined) continue;
    const texto = String(valor).trim();
    if (texto) return texto;
  }
  return '';
}

function cstDoItem(item) {
  const partes = [
    primeiroTexto(item.codigoCSTA, item.CSTA),
    primeiroTexto(item.codigoCSTB, item.CSTB),
  ].filter(Boolean);
  return partes.length ? partes.join(' / ') : primeiroTexto(item.cst, item.CST, item.codigoCst, item.codigoCST);
}

function descricaoDoItem(item) {
  return primeiroTexto(item.descricao, item.produto, item.xProd, item.nomeProduto);
}

function itemTemDevolucao(item) {
  const texto = [
    cstDoItem(item),
    descricaoDoItem(item),
    item.naturezaOperacao,
    item.cfop,
    item.CFOP,
    item.enquadramento,
    item.tipoOperacao,
  ].map((v) => String(v ?? '')).join(' ').toLowerCase();
  return texto.includes('devol');
}

function resumoCsts(itens) {
  const csts = new Set();
  for (const item of itens) {
    const cst = cstDoItem(item);
    if (cst) csts.add(cst);
  }
  return [...csts].sort().join('; ');
}

function resumoItensDevolucao(itens) {
  return itens
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => itemTemDevolucao(item))
    .slice(0, 10)
    .map(({ item, i }) => {
      const nItem = primeiroTexto(item.nItem, item.numeroItem, i + 1);
      const cst = cstDoItem(item) || '-';
      const desc = descricaoDoItem(item) || '-';
      return `${nItem}: CST ${cst} ${desc}`;
    })
    .join(' | ');
}

function temTramitaSelagem(detalhe) {
  const tramita = detalhe && typeof detalhe === 'object' ? detalhe.tramitaSelagem : null;
  if (!tramita || typeof tramita !== 'object') return false;
  const texto = JSON.stringify(tramita).toLowerCase();
  return /sucesso|criad|processo|selad|tramita|sanfit|protocolo/.test(texto);
}

function respostaContemChaveNfe(data, chave) {
  const chaveNormalizada = String(chave ?? '').replace(/\D/g, '');
  if (!chaveNormalizada) return false;

  if (typeof data === 'string') {
    return data.replace(/\D/g, '').includes(chaveNormalizada);
  }

  if (Array.isArray(data)) return data.some((item) => respostaContemChaveNfe(item, chaveNormalizada));

  if (data && typeof data === 'object') {
    return Object.values(data).some((valor) => respostaContemChaveNfe(valor, chaveNormalizada));
  }

  return false;
}

function textoProcessoTramita(data) {
  if (!data || typeof data !== 'object') return '';
  const fila = [data];
  const encontrados = [];
  const campos = ['numero', 'numeroProcesso', 'protocolo', 'id', 'situacao', 'status', 'descricaoStatus'];
  while (fila.length && encontrados.length < 8) {
    const atual = fila.shift();
    if (Array.isArray(atual)) {
      fila.push(...atual);
      continue;
    }
    if (!atual || typeof atual !== 'object') continue;
    for (const campo of campos) {
      if (atual[campo] !== undefined && atual[campo] !== null && String(atual[campo]).trim()) {
        encontrados.push(`${campo}: ${String(atual[campo]).trim()}`);
      }
    }
    for (const valor of Object.values(atual)) {
      if (valor && typeof valor === 'object') fila.push(valor);
    }
  }
  return [...new Set(encontrados)].join(' | ');
}

async function consultarProcessoPublico(chave) {
  const url = `https://api.sefaz.ce.gov.br/tramita/processo/sitram/consulta-processo-por-chave-nfe/${encodeURIComponent(chave)}`;
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    const raw = await resp.text();
    let data = raw;
    if (/^[\[{]/.test(raw.trim())) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = raw;
      }
    }
    if (resp.ok) {
      const confirmaChave = respostaContemChaveNfe(data, chave);
      return {
        encontrado: confirmaChave,
        statusHttp: resp.status,
        mensagem: confirmaChave
          ? textoProcessoTramita(data) || 'Processo localizado com chave confirmada.'
          : 'HTTP 200 sem confirmar a chave consultada.',
      };
    }
    const mensagem = typeof data === 'string'
      ? data
      : primeiroTexto(data?.userMessage, data?.message, data?.localizedMessage, data?.error);
    return {
      encontrado: false,
      statusHttp: resp.status,
      mensagem: mensagem || `HTTP ${resp.status}`,
    };
  } catch (error) {
    return {
      encontrado: false,
      statusHttp: 0,
      mensagem: error.message || 'Erro na consulta TRAMITA.',
    };
  }
}

async function consultarProcessosPublicos(chaves, concorrencia = 5) {
  const resultado = new Map();
  let indice = 0;
  async function worker() {
    while (indice < chaves.length) {
      const chave = chaves[indice++];
      resultado.set(chave, await consultarProcessoPublico(chave));
    }
  }
  await Promise.all(Array.from({ length: concorrencia }, () => worker()));
  return resultado;
}

function statusTramita(detalhe) {
  const tramita = detalhe && typeof detalhe === 'object' ? detalhe.tramitaSelagem : null;
  if (!tramita || typeof tramita !== 'object') return '';
  return primeiroTexto(
    tramita.status,
    tramita.situacao,
    tramita.mensagem,
    tramita.protocolo,
    tramita.processo,
    tramita.numeroProcesso,
  ) || JSON.stringify(tramita).slice(0, 300);
}

function simNao(valor) {
  if (valor === true) return 'SIM';
  if (valor === false) return 'NAO';
  return 'SEM INFO';
}

function writeCsv(file, headers, rows) {
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  fs.writeFileSync(
    file,
    `${headers.join(',')}\n${rows.map((row) => headers.map((h) => escape(row[h])).join(',')).join('\n')}\n`,
    'utf8',
  );
}

function avaliar(linha, nota, processoPublico) {
  if (!nota) {
    const jaSeladaPublico = processoPublico?.encontrado === true;
    return {
      ...linha,
      encontradaSistema: 'NAO',
      empresaSistema: '',
      numeroSistema: '',
      situacaoSefaz: '',
      statusXml: '',
      naturezaOp: '',
      sitramSelada: 'SEM INFO',
      processoTramitaPublico: jaSeladaPublico ? 'SIM' : 'NAO',
      processoTramitaDetalhe: processoPublico?.mensagem || '',
      jaSelada: jaSeladaPublico ? 'SIM' : 'SEM INFO',
      sitramSituacao: '',
      sitramDaeStatus: '',
      tramitaSelagem: '',
      qtdItensSitram: 0,
      cstsEncontrados: '',
      temDevolucao: 'SEM INFO',
      itensDevolucao: '',
      alertas: ['NAO ENCONTRADA NO SISTEMA', jaSeladaPublico ? 'JA SELADA/PROCESSO' : null].filter(Boolean).join('; '),
      recomendacao: 'Conferir/importar XML/SITRAM antes de decidir selagem.',
    };
  }

  const detalhe = parseJsonSeguro(nota.sitramDetalhe);
  const itens = coletarItens(detalhe);
  const tramita = temTramitaSelagem(detalhe);
  const processoPublicoEncontrado = processoPublico?.encontrado === true;
  const selada = nota.sitramSelada === true || tramita || processoPublicoEncontrado;
  const cancelada = nota.situacaoSefaz === 'CANCELADA' || nota.situacaoSefaz === 'CANCELADO';
  const textoNatureza = String(nota.naturezaOp ?? '').toLowerCase();
  const devolucao = textoNatureza.includes('devol') || itens.some(itemTemDevolucao);
  const alertas = [];

  if (!cancelada) alertas.push('NAO CANCELADA');
  if (devolucao) alertas.push('POSSIVEL DEVOLUCAO/CST');
  if (selada) alertas.push('JA SELADA/PROCESSO');
  if (!itens.length) alertas.push('SEM ITENS SITRAM/XML PARA CST');

  return {
    ...linha,
    encontradaSistema: 'SIM',
    empresaSistema: nota.cnpj?.razaoSocial || nota.cnpj?.cnpj || '',
    numeroSistema: nota.numero || '',
    situacaoSefaz: nota.situacaoSefaz || '',
    statusXml: nota.status || '',
    naturezaOp: nota.naturezaOp || '',
    sitramSelada: simNao(nota.sitramSelada),
    jaSelada: selada ? 'SIM' : 'NAO',
    sitramSituacao: nota.sitramSituacao || '',
    sitramDaeStatus: nota.sitramDaeStatus || '',
    tramitaSelagem: statusTramita(detalhe),
    processoTramitaPublico: processoPublicoEncontrado ? 'SIM' : 'NAO',
    processoTramitaDetalhe: processoPublico?.mensagem || '',
    qtdItensSitram: itens.length,
    cstsEncontrados: resumoCsts(itens),
    temDevolucao: devolucao ? 'SIM' : 'NAO',
    itensDevolucao: resumoItensDevolucao(itens),
    alertas: alertas.join('; ') || 'OK',
    recomendacao: alertas.length
      ? 'Revisar antes de qualquer selagem.'
      : 'Sem alerta nos dados atuais do sistema.',
  };
}

function agrupar(rows, chave) {
  const m = new Map();
  for (const row of rows) {
    const valor = row[chave] || 'SEM INFO';
    m.set(valor, (m.get(valor) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

async function salvarRelatorio(rows) {
  const outDir = path.resolve('outputs', 'selagem_urgente_2026-09-04');
  fs.mkdirSync(outDir, { recursive: true });
  const xlsxPath = path.join(outDir, 'relatorio_selagem_urgente.xlsx');
  const mdPath = path.join(outDir, 'relatorio_selagem_urgente.md');
  const faltantesMatrizPath = path.join(outDir, 'faltantes_facil_matriz_meudanfe.csv');
  const faltantesFilialPath = path.join(outDir, 'faltantes_facil_filial_meudanfe.csv');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Codex';
  wb.created = new Date();

  const resumo = wb.addWorksheet('Resumo');
  resumo.columns = [
    { header: 'Indicador', key: 'indicador', width: 42 },
    { header: 'Valor', key: 'valor', width: 18 },
  ];
  const total = rows.length;
  const encontradas = rows.filter((r) => r.encontradaSistema === 'SIM').length;
  resumo.addRows([
    { indicador: 'Total nas planilhas', valor: total },
    { indicador: 'Encontradas no sistema', valor: encontradas },
    { indicador: 'Nao encontradas no sistema', valor: total - encontradas },
    { indicador: 'Nao canceladas', valor: rows.filter((r) => r.alertas.includes('NAO CANCELADA')).length },
    { indicador: 'Possivel devolucao/CST', valor: rows.filter((r) => r.alertas.includes('POSSIVEL DEVOLUCAO/CST')).length },
    { indicador: 'Ja seladas/processo', valor: rows.filter((r) => r.alertas.includes('JA SELADA/PROCESSO')).length },
    { indicador: 'Processo TRAMITA publico localizado', valor: rows.filter((r) => r.processoTramitaPublico === 'SIM').length },
    { indicador: 'Sem itens para validar CST', valor: rows.filter((r) => r.alertas.includes('SEM ITENS')).length },
  ]);
  resumo.addRow({});
  resumo.addRow({ indicador: 'Por arquivo', valor: '' });
  for (const [arquivo, qtd] of agrupar(rows, 'arquivo')) resumo.addRow({ indicador: arquivo, valor: qtd });
  resumo.getRow(1).font = { bold: true };

  const detalhe = wb.addWorksheet('Detalhe');
  detalhe.columns = [
    { header: 'Empresa planilha', key: 'empresaPlanilha', width: 16 },
    { header: 'Arquivo', key: 'arquivo', width: 34 },
    { header: 'Linha', key: 'linha', width: 8 },
    { header: 'Chave NF-e', key: 'chave', width: 48 },
    { header: 'Numero planilha', key: 'numeroPlanilha', width: 16 },
    { header: 'Emissao planilha', key: 'emissaoPlanilha', width: 16 },
    { header: 'Valor planilha', key: 'valorPlanilha', width: 14 },
    { header: 'Encontrada sistema', key: 'encontradaSistema', width: 18 },
    { header: 'Empresa sistema', key: 'empresaSistema', width: 28 },
    { header: 'Numero sistema', key: 'numeroSistema', width: 16 },
    { header: 'Situacao SEFAZ', key: 'situacaoSefaz', width: 18 },
    { header: 'Status XML', key: 'statusXml', width: 14 },
    { header: 'Natureza operacao', key: 'naturezaOp', width: 32 },
    { header: 'SITRAM selada', key: 'sitramSelada', width: 14 },
    { header: 'Ja selada/processo', key: 'jaSelada', width: 18 },
    { header: 'SITRAM situacao', key: 'sitramSituacao', width: 28 },
    { header: 'DAE status', key: 'sitramDaeStatus', width: 18 },
    { header: 'TRAMITA selagem', key: 'tramitaSelagem', width: 40 },
    { header: 'Processo TRAMITA publico', key: 'processoTramitaPublico', width: 22 },
    { header: 'Detalhe processo publico', key: 'processoTramitaDetalhe', width: 48 },
    { header: 'Qtd itens', key: 'qtdItensSitram', width: 10 },
    { header: 'CSTs encontrados', key: 'cstsEncontrados', width: 28 },
    { header: 'Tem devolucao/CST', key: 'temDevolucao', width: 18 },
    { header: 'Itens devolucao', key: 'itensDevolucao', width: 48 },
    { header: 'Alertas', key: 'alertas', width: 46 },
    { header: 'Recomendacao', key: 'recomendacao', width: 42 },
  ];
  detalhe.addRows(rows);
  detalhe.getRow(1).font = { bold: true };
  detalhe.views = [{ state: 'frozen', ySplit: 1 }];
  detalhe.autoFilter = { from: 'A1', to: `Z${rows.length + 1}` };
  for (const row of detalhe.getRows(2, rows.length) ?? []) {
    const alertas = String(row.getCell('alertas').value ?? '');
    if (alertas.includes('NAO CANCELADA')) {
      row.getCell('alertas').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    } else if (alertas !== 'OK') {
      row.getCell('alertas').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
    }
  }

  await wb.xlsx.writeFile(xlsxPath);

  const linhasMd = [
    '# Relatorio de auditoria - selagem urgente',
    '',
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    '',
    `- Total nas planilhas: ${total}`,
    `- Encontradas no sistema: ${encontradas}`,
    `- Nao encontradas no sistema: ${total - encontradas}`,
    `- Nao canceladas: ${rows.filter((r) => r.alertas.includes('NAO CANCELADA')).length}`,
    `- Possivel devolucao/CST: ${rows.filter((r) => r.alertas.includes('POSSIVEL DEVOLUCAO/CST')).length}`,
    `- Ja seladas/processo: ${rows.filter((r) => r.alertas.includes('JA SELADA/PROCESSO')).length}`,
    `- Processo TRAMITA publico localizado: ${rows.filter((r) => r.processoTramitaPublico === 'SIM').length}`,
    `- Sem itens para validar CST: ${rows.filter((r) => r.alertas.includes('SEM ITENS')).length}`,
    '',
    '## Principais alertas',
    '',
    '| Empresa | Nota | Chave | Situacao | Selada | Devolucao/CST | Alertas |',
    '|---|---:|---|---|---|---|---|',
    ...rows
      .filter((r) => r.alertas !== 'OK')
      .slice(0, 80)
      .map((r) => `| ${r.empresaPlanilha} | ${r.numeroPlanilha} | ${r.chave} | ${r.situacaoSefaz || '-'} | ${r.jaSelada} | ${r.temDevolucao} | ${r.alertas} |`),
  ];
  fs.writeFileSync(mdPath, linhasMd.join('\n'), 'utf8');

  const faltantes = rows.filter((r) => r.encontradaSistema !== 'SIM');
  const headersCsv = ['chave', 'numeroPlanilha', 'empresaPlanilha', 'arquivo', 'linha'];
  writeCsv(
    faltantesMatrizPath,
    headersCsv,
    faltantes.filter((r) => r.empresaPlanilha === 'FACIL MATRIZ'),
  );
  writeCsv(
    faltantesFilialPath,
    headersCsv,
    faltantes.filter((r) => r.empresaPlanilha === 'FACIL FILIAL'),
  );

  return { xlsxPath, mdPath, faltantesMatrizPath, faltantesFilialPath };
}

async function main() {
  carregarEnv();
  const entradas = await lerPlanilhas();
  const chaves = [...new Set(entradas.map((l) => l.chave))];
  const processosPublicos = await consultarProcessosPublicos(chaves);
  const prisma = new PrismaClient();
  try {
    const notas = await prisma.notaFiscal.findMany({
      where: { chave: { in: chaves } },
      select: {
        chave: true,
        numero: true,
        status: true,
        situacaoSefaz: true,
        naturezaOp: true,
        sitramSelada: true,
        sitramSituacao: true,
        sitramDaeStatus: true,
        sitramDetalhe: true,
        cnpj: { select: { cnpj: true, razaoSocial: true } },
      },
    });
    const porChave = new Map(notas.map((n) => [n.chave, n]));
    const rows = entradas.map((linha) => avaliar(linha, porChave.get(linha.chave), processosPublicos.get(linha.chave)));
    const saida = await salvarRelatorio(rows);
    const resumo = {
      total: rows.length,
      chavesUnicas: chaves.length,
      encontradas: rows.filter((r) => r.encontradaSistema === 'SIM').length,
      naoEncontradas: rows.filter((r) => r.encontradaSistema !== 'SIM').length,
      naoCanceladas: rows.filter((r) => r.alertas.includes('NAO CANCELADA')).length,
      possivelDevolucaoCst: rows.filter((r) => r.alertas.includes('POSSIVEL DEVOLUCAO/CST')).length,
      jaSeladas: rows.filter((r) => r.alertas.includes('JA SELADA/PROCESSO')).length,
      processosTramitaPublicos: rows.filter((r) => r.processoTramitaPublico === 'SIM').length,
      semItensCst: rows.filter((r) => r.alertas.includes('SEM ITENS')).length,
      xlsx: saida.xlsxPath,
      markdown: saida.mdPath,
      faltantesMatriz: saida.faltantesMatrizPath,
      faltantesFilial: saida.faltantesFilialPath,
    };
    console.log(JSON.stringify(resumo, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
