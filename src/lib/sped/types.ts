/**
 * Tipos TypeScript para os registros do SPED Fiscal (EFD ICMS/IPI).
 * Cobre os blocos 0 (abertura/cadastros), C (documentos fiscais) e E (apuração).
 * Referência: Guia Prático da EFD ICMS/IPI (layout 017+).
 */

// ─── Enums ────────────────────────────────────────────────────────────────

/** Indicador de tipo de operação: 0 = Entrada, 1 = Saída */
export enum SpedIndicadorOperacao {
  ENTRADA = '0',
  SAIDA = '1',
}

/** Finalidade do arquivo: 0 = Original, 1 = Substituto (retificador) */
export enum SpedFinalidade {
  ORIGINAL = '0',
  RETIFICADORA = '1',
}

/** Indicador de emitente: 0 = Emissão própria, 1 = Terceiros */
export enum SpedIndicadorEmitente {
  PROPRIA = '0',
  TERCEIROS = '1',
}

/** Código da situação do documento: 00 = Regular, 01 = Extemporâneo, 02 = Cancelado, etc. */
export enum SpedCodigoSituacao {
  REGULAR = '00',
  EXTEMPORANEO = '01',
  CANCELADO = '02',
  CANCELADO_EXTEMPORANEO = '03',
  DENEGADO = '04',
  NUMERACAO_INUTILIZADA = '05',
  COMPLEMENTAR = '06',
  COMPLEMENTAR_EXTEMPORANEO = '07',
  REGIME_ESPECIAL = '08',
}

// ─── Registro 0000 — Abertura do arquivo ────────────────────────────────

export interface SpedRegistro0000 {
  registro: '0000';
  codigoVersao: string;       // COD_VER — versão do layout (ex: "017")
  codigoFinalidade: SpedFinalidade;
  dataInicial: string;        // DT_INI — dd/mm/aaaa
  dataFinal: string;           // DT_FIN — dd/mm/aaaa
  nome: string;                // NOME — razão social
  cnpj: string;                // CNPJ — 14 dígitos
  cpf: string;                 // CPF
  uf: string;                  // UF
  ie: string;                  // IE
  codigoMunicipio: string;     // COD_MUN — IBGE
  im: string;                  // IM — inscrição municipal
  suframa: string;             // SUFRAMA
  indicadorPerfil: string;     // IND_PERFIL — A, B ou C
  indicadorAtividade: string;  // IND_ATIV — 0=Industrial/equiparado, 1=Outros
  linha: number;               // linha do arquivo (para referência de divergências)
}

// ─── Registro 0150 — Tabela de Participantes ────────────────────────────

export interface SpedRegistro0150 {
  registro: '0150';
  codigoParticipante: string;  // COD_PART — código interno no ERP
  nome: string;                // NOME
  codigoPais: string;          // COD_PAIS
  cnpj: string;                // CNPJ
  cpf: string;                 // CPF
  ie: string;                  // IE
  codigoMunicipio: string;     // COD_MUN
  suframa: string;             // SUFRAMA
  endereco: string;            // END
  numero: string;              // NUM
  complemento: string;         // COMPL
  bairro: string;              // BAIRRO
  linha: number;
}

// ─── Registro 0190 — Unidades de Medida ─────────────────────────────────

export interface SpedRegistro0190 {
  registro: '0190';
  unidade: string;             // UNID
  descricao: string;           // DESCR
  linha: number;
}

// ─── Registro 0200 — Tabela de Identificação do Item ────────────────────

export interface SpedRegistro0200 {
  registro: '0200';
  codigoItem: string;          // COD_ITEM
  descricao: string;           // DESCR_ITEM
  codigoBarras: string;        // COD_BARRA — EAN/GTIN
  codigoAnterior: string;      // COD_ANT_ITEM
  unidade: string;             // UNID_INV
  tipoItem: string;            // TIPO_ITEM (00=Mercadoria p/ revenda, 01=Matéria-prima, ...)
  ncm: string;                 // COD_NCM
  exIpi: string;               // EX_IPI
  codigoGenero: string;        // COD_GEN
  codigoServico: string;       // COD_LST
  aliquotaIcms: string;        // ALIQ_ICMS
  cest: string;                // CEST
  linha: number;
}

// ─── Registro 0220 — Fatores de Conversão de Unidade ────────────────────

export interface SpedRegistro0220 {
  registro: '0220';
  codigoItem: string;          // pai: COD_ITEM do 0200
  unidadeConversao: string;    // UNID_CONV
  fatorConversao: number;      // FAT_CONV
  codigoBarras: string;        // COD_BARRA (a partir de layout 015)
  linha: number;
}

// ─── Registro C100 — NF-e (Cabeçalho) ──────────────────────────────────

export interface SpedRegistroC100 {
  registro: 'C100';
  indicadorOperacao: SpedIndicadorOperacao;  // IND_OPER
  indicadorEmitente: SpedIndicadorEmitente;  // IND_EMIT
  codigoParticipante: string;               // COD_PART
  codigoModelo: string;                     // COD_MOD (55=NF-e, 65=NFC-e)
  codigoSituacao: SpedCodigoSituacao;       // COD_SIT
  serie: string;                            // SER
  numero: string;                           // NUM_DOC
  chaveNfe: string;                         // CHV_NFE — 44 dígitos
  dataDocumento: string;                    // DT_DOC — dd/mm/aaaa
  dataEntradaSaida: string;                 // DT_E_S
  valorDocumento: number;                   // VL_DOC
  indicadorPagamento: string;               // IND_PGTO
  valorDesconto: number;                    // VL_DESC
  valorAbatimento: number;                  // VL_ABAT_NT
  valorMercadorias: number;                 // VL_MERC
  indicadorFrete: string;                   // IND_FRT
  valorFrete: number;                       // VL_FRT
  valorSeguro: number;                      // VL_SEG
  valorOutrasDespesas: number;              // VL_OUT_DA
  valorBaseIcms: number;                    // VL_BC_ICMS
  valorIcms: number;                        // VL_ICMS
  valorBaseIcmsSt: number;                  // VL_BC_ICMS_ST
  valorIcmsSt: number;                      // VL_ICMS_ST
  valorIpi: number;                         // VL_IPI
  valorPis: number;                         // VL_PIS
  valorCofins: number;                      // VL_COFINS
  valorPisSt: number;                       // VL_PIS_ST
  valorCofinsSt: number;                    // VL_COFINS_ST
  linha: number;
  // Itens filhos (C170) associados durante o parsing
  itens: SpedRegistroC170[];
  // Consolidações (C190) associadas
  consolidacoes: SpedRegistroC190[];
}

// ─── Registro C170 — Itens do Documento (NF-e) ─────────────────────────

export interface SpedRegistroC170 {
  registro: 'C170';
  numeroItem: string;             // NUM_ITEM
  codigoItem: string;             // COD_ITEM
  descricao: string;              // DESCR_COMPL
  quantidade: number;             // QTD
  unidade: string;                // UNID
  valorItem: number;              // VL_ITEM
  valorDesconto: number;          // VL_DESC
  indicadorMovimento: string;     // IND_MOV
  cstIcms: string;                // CST_ICMS
  cfop: string;                   // CFOP
  codigoNatureza: string;         // COD_NAT
  valorBaseIcms: number;          // VL_BC_ICMS
  aliquotaIcms: number;           // ALIQ_ICMS
  valorIcms: number;              // VL_ICMS
  valorBaseIcmsSt: number;        // VL_BC_ICMS_ST
  aliquotaIcmsSt: number;         // ALIQ_ST
  valorIcmsSt: number;            // VL_ICMS_ST
  indicadorApur: string;          // IND_APUR
  cstIpi: string;                 // CST_IPI
  codigoEnquadramentoIpi: string; // COD_ENQ
  valorBaseIpi: number;           // VL_BC_IPI
  aliquotaIpi: number;            // ALIQ_IPI
  valorIpi: number;               // VL_IPI
  cstPis: string;                 // CST_PIS
  valorBasePis: number;           // VL_BC_PIS
  aliquotaPis: number;            // ALIQ_PIS
  valorPis: number;               // VL_PIS
  cstCofins: string;              // CST_COFINS
  valorBaseCofins: number;        // VL_BC_COFINS
  aliquotaCofins: number;         // ALIQ_COFINS
  valorCofins: number;            // VL_COFINS
  codigoNcm: string;              // COD_NCM (pode estar vazio; aí usa o do 0200)
  linha: number;
  // Referência ao pai (chave NFe do C100)
  chaveNfePai?: string;
}

// ─── Registro C190 — Consolidação por CFOP/CST ─────────────────────────

export interface SpedRegistroC190 {
  registro: 'C190';
  cstIcms: string;        // CST_ICMS
  cfop: string;            // CFOP
  aliquotaIcms: number;    // ALIQ_ICMS
  valorOperacao: number;   // VL_OPR — valor da operação
  valorBaseIcms: number;   // VL_BC_ICMS
  valorIcms: number;       // VL_ICMS
  valorBaseIcmsSt: number; // VL_BC_ICMS_ST
  valorIcmsSt: number;     // VL_ICMS_ST
  valorIpi: number;        // VL_IPI (a partir de layout recente)
  valorIcmsDesonerado: number; // VL_RED_BC
  linha: number;
  chaveNfePai?: string;
}

// ─── Registro E110 — Apuração do ICMS — Operações Próprias ─────────────

export interface SpedRegistroE110 {
  registro: 'E110';
  valorTotalDebitos: number;          // VL_TOT_DEBITOS
  valorAjustesDebitos: number;        // VL_AJ_DEBITOS
  valorTotalAjustesDebitos: number;   // VL_TOT_AJ_DEBITOS
  valorEstornosCredito: number;       // VL_ESTORNOS_CRED
  valorTotalCreditos: number;         // VL_TOT_CREDITOS
  valorAjustesCreditos: number;       // VL_AJ_CREDITOS
  valorTotalAjustesCreditos: number;  // VL_TOT_AJ_CREDITOS
  valorEstornosDebito: number;        // VL_ESTORNOS_DEB
  saldoCredorAnterior: number;        // VL_SLD_CREDOR_ANT
  saldoDevedor: number;               // VL_SLD_APURADO
  valorTotalDeducoes: number;         // VL_TOT_DED
  valorIcmsRecolher: number;          // VL_ICMS_RECOLHER
  saldoCredorTransportar: number;     // VL_SLD_CREDOR_TRANSPORTAR
  valorDebitoEspecial: number;        // DEB_ESP
  linha: number;
}

// ─── Resultado do Parsing ───────────────────────────────────────────────

export interface SpedFiscalParsed {
  /** Registro 0000 — informações da empresa e período */
  abertura: SpedRegistro0000;
  /** Registro 0150 — participantes (fornecedores/clientes) */
  participantes: SpedRegistro0150[];
  /** Registro 0190 — unidades de medida */
  unidades: SpedRegistro0190[];
  /** Registro 0200 — produtos e serviços */
  produtos: SpedRegistro0200[];
  /** Registro 0220 — fatores de conversão de unidade */
  conversoes: SpedRegistro0220[];
  /** Registro C100 — NF-e com itens (C170) e consolidações (C190) já vinculados */
  notasFiscais: SpedRegistroC100[];
  /** Registro E110 — apuração do ICMS (pode haver mais de um em layout com sub-apuração) */
  apuracoesIcms: SpedRegistroE110[];
  /** Estatísticas do parsing */
  estatisticas: SpedEstatisticasParsing;
}

export interface SpedEstatisticasParsing {
  totalLinhas: number;
  totalRegistrosLidos: number;
  totalRegistrosIgnorados: number;
  total0150: number;
  total0200: number;
  totalC100: number;
  totalC170: number;
  totalC190: number;
  totalE110: number;
  /** Quantidade de linhas por código de registro (inclusive os que não são interpretados) */
  contagemRegistros: Record<string, number>;
  registrosDesconhecidos: string[];
  erros: SpedErroParsing[];
}

export interface SpedErroParsing {
  linha: number;
  registro: string;
  mensagem: string;
}
