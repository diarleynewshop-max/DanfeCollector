import * as net from 'net';

export interface ACBrResponse {
  ok: boolean;
  message: string;
  data?: string;
}

// O ACBrMonitorPlus delimita cada resposta com o byte ETX (0x03).
const ETX = String.fromCharCode(3);

/**
 * Formata uma data no padrão exigido pela SEFAZ para eventos:
 * yyyy-MM-ddTHH:mm:ss-03:00 (hora local + offset do fuso).
 */
function formatarDataEvento(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sinal = offsetMin >= 0 ? '+' : '-';
  const offsetAbs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sinal}${pad(Math.floor(offsetAbs / 60))}:${pad(offsetAbs % 60)}`
  );
}

export class ACBrService {
  private host: string;
  private port: number;
  private timeoutMs: number;

  constructor(
    host: string = process.env.ACBR_HOST || '127.0.0.1',
    port: number = Number(process.env.ACBR_PORT) || 3434,
    timeoutMs: number = 60000
  ) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Envia um comando para o ACBrMonitorPlus e aguarda a resposta completa.
   *
   * Protocolo: ao conectar, o monitor pode enviar um banner de boas-vindas
   * terminado em ETX. Cada resposta de comando também termina em ETX.
   * Acumulamos os dados e processamos mensagem a mensagem, ignorando o banner.
   */
  public async enviarComando(comando: string): Promise<ACBrResponse> {
    return new Promise((resolve) => {
      const client = new net.Socket();
      let buffer = '';
      let finalizado = false;

      const finalizar = (res: ACBrResponse) => {
        if (finalizado) return;
        finalizado = true;
        client.destroy();
        resolve(res);
      };

      client.setTimeout(this.timeoutMs, () => {
        finalizar({
          ok: false,
          message: `Timeout (${this.timeoutMs / 1000}s) na comunicação com o ACBrMonitorPlus. Verifique se a consulta à SEFAZ não está travada.`,
        });
      });

      client.connect(this.port, this.host, () => {
        // O ACBrMonitor só processa o comando após receber uma linha contendo
        // apenas um ponto (terminador estilo SMTP) — sem ela, ele espera até o
        // TCP_TimeOut e derruba a conexão (ECONNRESET).
        client.write(`${comando}\r\n.\r\n`);
      });

      client.on('data', (data) => {
        // Com Converte_TCP_Ansi=0 (padrão), o monitor responde em UTF-8
        buffer += data.toString('utf8');

        // Processa todas as mensagens completas (delimitadas por ETX) já recebidas
        let idx: number;
        while ((idx = buffer.indexOf(ETX)) !== -1) {
          const mensagem = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);

          // Banner de conexão do monitor — ignora e segue aguardando a resposta real
          if (/ACBrMonitor/i.test(mensagem) && !mensagem.startsWith('OK') && !mensagem.startsWith('ERRO')) {
            continue;
          }

          const ok = mensagem.startsWith('OK');
          const corpo = mensagem.replace(/^(OK:?|ERRO:?)\s*/i, '').trim();
          finalizar({ ok, message: corpo, data: mensagem });
          return;
        }
      });

      client.on('error', (err: NodeJS.ErrnoException) => {
        const dica =
          err.code === 'ECONNREFUSED'
            ? ' O ACBrMonitorPlus está aberto e com o TCP ativo na porta ' + this.port + '?'
            : '';
        finalizar({ ok: false, message: `Erro de conexão com o ACBr: ${err.message}.${dica}` });
      });

      client.on('close', () => {
        // Conexão encerrada sem ETX final — usa o que tiver no buffer
        if (buffer.trim().length > 0) {
          const ok = buffer.trim().startsWith('OK');
          finalizar({ ok, message: buffer.trim(), data: buffer.trim() });
        } else {
          finalizar({ ok: false, message: 'Conexão encerrada pelo ACBr sem resposta.' });
        }
      });
    });
  }

  /** Verifica se o monitor está respondendo. */
  public async ativo(): Promise<ACBrResponse> {
    return this.enviarComando('ACBr.Ativo');
  }

  /**
   * Consulta a data de vencimento do certificado digital configurado no ACBr.
   * Útil para validar se o certificado foi carregado corretamente.
   */
  public async consultarCertificado(): Promise<ACBrResponse> {
    return this.enviarComando('NFE.CertificadoDataVencimento');
  }

  /** Consulta o status do serviço da SEFAZ (exige certificado válido). */
  public async statusServico(): Promise<ACBrResponse> {
    return this.enviarComando('NFE.StatusServico');
  }

  /**
   * Consulta documentos fiscais na SEFAZ via Distribuição DFe.
   * @param uf   UF do interessado (ex.: "CE")
   * @param cnpj CNPJ do interessado (somente dígitos)
   * @param nsu  Último NSU consultado ('0' para buscar desde o início)
   */
  public async consultarDFe(uf: string, cnpj: string, nsu: string = '0'): Promise<ACBrResponse> {
    const comando = `NFE.DistribuicaoDFePorUltNSU("${uf}", "${cnpj}", "${nsu}")`;
    return this.enviarComando(comando);
  }

  /**
   * Realiza a Manifestação do Destinatário — Ciência da Operação (evento 210210).
   * Necessário para liberar o download do XML completo na SEFAZ.
   */
  public async manifestarCiencia(cnpj: string, chave: string): Promise<ACBrResponse> {
    const ini = [
      '[EVENTO]',
      'idLote=1',
      '[EVENTO001]',
      'cOrgao=91',
      `CNPJ=${cnpj}`,
      `chNFe=${chave}`,
      `dhEvento=${formatarDataEvento(new Date())}`,
      'tpEvento=210210',
      'nSeqEvento=1',
      'versaoEvento=1.00',
    ].join('\r\n');

    const comando = `NFE.EnviarEvento("${ini}")`;
    return this.enviarComando(comando);
  }
}

export const acbr = new ACBrService();
