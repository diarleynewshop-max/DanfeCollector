// Utilidades de cor para etiquetas: sugestão automática (círculo cromático)
// e conversão HSL -> hex usada tanto na sugestão quanto na roda de cores.

export function hslParaHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lig = Math.min(100, Math.max(0, l)) / 100;

  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const canal = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

// Ângulo de ouro: espalha as cores pelo círculo cromático de forma bem
// distinta a cada nova etiqueta, sem repetir tons parecidos em sequência.
const ANGULO_OURO = 137.508;

export function sugerirCorEtiqueta(quantidadeExistente: number): string {
  const hue = (quantidadeExistente * ANGULO_OURO) % 360;
  return hslParaHex(hue, 65, 48);
}

// Cor determinística de fallback para etiquetas antigas (aplicadas antes
// dessa funcionalidade existir) que ainda não têm linha em EtiquetaDefinicao:
// mesmo nome sempre cai na mesma cor, sem precisar salvar nada.
export function corPadraoEtiqueta(nome: string): string {
  let hash = 0;
  for (let i = 0; i < nome.length; i++) hash = (hash * 31 + nome.charCodeAt(i)) >>> 0;
  return hslParaHex(hash % 360, 55, 46);
}

// Preto ou branco, o que tiver mais contraste em cima da cor de fundo dada.
export function corTextoContraste(hex: string): '#000000' | '#ffffff' {
  const limpo = hex.replace('#', '');
  const r = parseInt(limpo.slice(0, 2), 16) / 255;
  const g = parseInt(limpo.slice(2, 4), 16) / 255;
  const b = parseInt(limpo.slice(4, 6), 16) / 255;
  const luminancia = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminancia > 0.6 ? '#000000' : '#ffffff';
}

// As cores mostradas na roda de seleção (círculo cromático), igualmente
// espaçadas — diferente da sugestão automática, que usa ângulo de ouro.
export function coresRodaCromatica(quantidade = 16): string[] {
  const cores: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    cores.push(hslParaHex((360 / quantidade) * i, 70, 50));
  }
  return cores;
}
