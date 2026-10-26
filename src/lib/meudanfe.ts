const API = 'https://api.meudanfe.com.br/v2/fd';

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function meuDanfeConfigurado(): boolean {
  return Boolean(process.env.MEUDANFE_API_KEY?.trim());
}

/**
 * Busca o XML completo (nfeProc) de uma NF-e pela chave na API do MeuDanfe.
 * Serve para notas antigas, que a SEFAZ já não entrega (cStat 632). Só a chave
 * trafega para o terceiro. Devolve null quando não há chave configurada, a nota
 * não existe lá ou o XML devolvido não é o da chave pedida.
 */
export async function buscarXmlMeuDanfe(chave: string): Promise<string | null> {
  const apiKey = process.env.MEUDANFE_API_KEY?.trim();
  if (!apiKey || !/^\d{44}$/.test(chave)) return null;
  const headers = { 'Api-Key': apiKey, Accept: 'application/json' };

  await fetch(`${API}/add/${chave}`, { method: 'PUT', headers, signal: AbortSignal.timeout(20000) }).catch(() => null);

  for (let tentativa = 1; tentativa <= 4; tentativa++) {
    await esperar(1500);
    const res = await fetch(`${API}/get/xml/${chave}`, { headers, signal: AbortSignal.timeout(20000) }).catch(() => null);
    const dados = (await res?.json().catch(() => null)) as { data?: unknown } | null;
    const xml = typeof dados?.data === 'string' ? dados.data : '';
    if (xml.includes('<infNFe')) {
      return xml.includes(`Id="NFe${chave}"`) && xml.includes('<nfeProc') ? xml : null;
    }
  }
  return null;
}
