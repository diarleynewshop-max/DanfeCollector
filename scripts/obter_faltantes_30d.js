const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const CNPJS_INTERNOS = new Set([
  '45998339000167',
  '45998339000248',
  '45998339000329',
  '45998339000400',
  '50767035000129',
  '50767035000200',
  '62803717000129',
]);

async function getNotasErp(domain, username, password, empresaNome) {
  const params = new URLSearchParams({ j_username: username, j_password: password });
  const loginRes = await fetch(`https://${domain}/j_spring_security_check?` + params.toString(), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `https://${domain}/login`,
    },
  });
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const match = setCookie.match(/JSESSIONID=([^;]+)/);
  if (!match) return [];
  const cookie = `JSESSIONID=${match[1]}`;

  const url = new URL(`https://${domain}/notaFiscalCompra/pesquisa`);
  url.searchParams.set('filtro.dataInicial', '01/08/2026');
  url.searchParams.set('filtro.dataFinal', '09/09/2026');
  url.searchParams.set('filtro.tipoData', 'EMISSAO');
  url.searchParams.set('filtro.skipPagina', '0');
  url.searchParams.set('filtro.pageSize', '300');
  url.searchParams.set('filtro.totalPagina', '-1');
  url.searchParams.set('_', String(Date.now()));

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://${domain}/notaFiscalCompra/index`,
      Cookie: cookie,
    }
  });

  const data = await res.json();
  const mapa = new Map();
  for (const n of data.notas || []) {
    const emissao = String(n.dataDaEmissao || '');
    if (n.chaveDaNfe && (emissao.startsWith('2026-08') || emissao.startsWith('2026-09'))) {
      const emitenteNaChave = n.chaveDaNfe.slice(6, 20);
      if (!CNPJS_INTERNOS.has(emitenteNaChave)) {
        mapa.set(n.chaveDaNfe, n);
      }
    }
  }
  return Array.from(mapa.values());
}

async function getFaltantes() {
  const notasNewshop = await getNotasErp('newshop.varejofacil.com', '2', '1212', 'NEWSHOP');
  const notasFacil = await getNotasErp('facil.varejofacil.com', '2', '1212', 'FACIL');

  const todasErp = [
    ...notasNewshop.map(n => ({ ...n, origemErp: 'NEWSHOP', cnpjPadrao: '45998339000167' })),
    ...notasFacil.map(n => ({ ...n, origemErp: 'FACIL', cnpjPadrao: n.loja?.codigo === 2 ? '50767035000200' : '50767035000129' })),
  ];

  const faltantes = [];
  for (const n of todasErp) {
    const dbNota = await prisma.notaFiscal.findUnique({
      where: { chave: n.chaveDaNfe },
    });
    if (!dbNota) {
      faltantes.push({
        chave: n.chaveDaNfe,
        cnpj: n.cnpjPadrao,
        numero: n.numeroDoDocumento,
        fornecedor: n.descricaoDaPessoa,
        valor: n.valorDoDocumento,
        emissao: n.dataDaEmissao,
      });
    }
  }
  return faltantes;
}

module.exports = { getFaltantes };
