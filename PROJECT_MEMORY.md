# Projeto: DanfeCollector - Sistema de Gestão de Notas Fiscais (SEFAZ Direto)

## 🎯 Objetivo Central
Transformar a gestão manual de planilhas de NF-e (baseado no modelo `NOTA FISCAL - NEWSHOP 2026.xlsx`) em um aplicativo automatizado. O sistema deve capturar todas as Notas Fiscais emitidas contra os CNPJs do usuário diretamente da SEFAZ, permitindo visualização, filtros, gestão de status e manipulação total dos dados sem depender de APIs pagas.

---

## 🚀 Progresso Atual (Junho 2026)
- [x] **Arquitetura Definida:** Next.js + Tailwind + Prisma (SQLite) + ACBrMonitorPlus.
- [x] **Integração SEFAZ:** Criado `ACBrService` para comunicação direta via certificado digital (Custo Zero).
- [x] **Interface Inicial:** Dashboard funcional com status de conexão e lista de notas (Mock).
- [x] **Banco de Dados:** Schema Prisma definido com tabelas de `Cnpj` e `NotaFiscal`.
- [x] **Configuração:** Estrutura de `.env` e mapeamento de pastas de download.

---

## 🗺️ Roadmap de Desenvolvimento

### Fase 1: Estabilização e Conectividade (CONCLUÍDA — código)
- [x] Corrigir erros de comunicação Socket com ACBr (protocolo ETX, banner, timeout, env vars).
- [x] Implementar a persistência real de novos CNPJs no Banco de Dados (CRUD completo com validação de dígito verificador).
- [x] Validar a leitura do certificado digital via ACBr (`NFE.CertificadoDataVencimento` + alerta de vencimento).
- [ ] **Teste em ambiente real:** validar contra ACBrMonitorPlus rodando com certificado A1 carregado.

### Fase 2: Sincronização e Download (EM ANDAMENTO — arquitetura migrada para SEFAZ direto)
- [x] **Cliente SEFAZ direto em Node.js:** `src/lib/sefaz/` — SOAP+mTLS no Ambiente Nacional, sem ACBr.
- [x] **Captura de Resumos:** Loop de consulta `DistribuicaoDFe` com paginação por NSU (até alcançar maxNSU).
- [x] **Tratamento de cStat:** 137 (sem docs), 138 (docs localizados), 656 (consumo indevido → bloqueio de 65min persistido em `bloqueadoAte`).
- [x] **Parser de XML:** resNFe (resumo) e procNFe (completa) → emitente, valor, datas no banco; XMLs salvos em `downloads/{CNPJ}/{ANO}/{MES}/`.
- [x] **Certificado:** `.pfx` em `certs/matriz.pfx` configurado no `.env`. Sincronização validada em produção (notas reais capturadas).
- [x] **Fluxo de Manifestação:** Ciência da Operação (evento 210210) implementada — `src/lib/sefaz/manifestacao.ts` + `assinatura.ts` (xml-crypto + node-forge extraindo PEM do .pfx; RSA-SHA1, C14N, Signature após infEvento). Action `manifestarNota` + botão "Manifestar" nas notas RESUMO; após aceite (cStat 135/136/573), re-sincroniza para baixar o procNFe completo. Assinatura validada offline; **falta o primeiro envio real à SEFAZ** (ação do usuário — rejeição é inócua).

### Fase 3: Visão "Estilo Planilha" (O Coração do App)
- [x] **Relatório Dinâmico:** Tabela de notas com filtro por CNPJ e por status; total somado; detalhe expansível com todo o cabeçalho (menos produtos) e chave completa.
- [x] **DANFE + Itens:** Aba DANFE gera a nota a partir do XML (`app/components/DanfeView.tsx`) com rota de impressão/PDF em `/danfe/[chave]`; aba Itens lista item a item (`ItensView.tsx`). Parser em `src/lib/sefaz/detalhe.ts`. Só funciona para notas COMPLETA.
- [x] **DANFE oficial via MeuDanfe (grátis):** rota `/danfe/[chave]/pdf` envia o XML completo à API gratuita `https://ws.meudanfe.com/api/v1/get/nfe/xmltodanfepdf/API` (POST text/plain, resposta PDF em base64) e cacheia o PDF no disco (`pdfPath`). ATENÇÃO: o XML trafega por servidores de terceiros. A API v2 (com mais recursos) exige API-Key paga; usamos o endpoint grátis legado.
- [x] **Manifestação (Ciência da Operação):** IMPLEMENTADA — evento 210210 assinado (xml-crypto + node-forge) e enviado ao Ambiente Nacional. Botão "Manifestar" nas notas RESUMO. Proteção contra Ciência dupla (`manifestadaEm` + detecção de eventos 210210 na sync). Assinatura validada offline; falta 1º envio real à SEFAZ.
- [x] **Importação por chave (Excel):** painel "📥 Importar chaves" — cola as chaves, busca via `consChNFe` (consulta direta por chave, ignora NSU). **MAS** descobrimos que consChNFe também tem limite de ~90 dias (cStat 632 para notas antigas).
- [x] **Importação de pasta de XMLs:** `importarXmlsDaPasta` — lê .xml recursivo de uma pasta, associa por CNPJ emit/dest cadastrado. ÚNICA forma de trazer notas >90 dias (2024/2025), cujos XMLs o contador guarda.
- [x] **Filtros avançados na tabela de notas (15/06/2026):** painel "🔍 Filtros" com busca por Emitente (nome/CNPJ), Destinatário (nome/CNPJ), faixa de Valor da NF, faixa de Qtd. de Itens e filtro por Etiqueta (+ "sem etiqueta"). Contador de filtros ativos e botão "Limpar filtros avançados".
- [x] **Autocomplete de Emitente/Destinatário (15/06/2026):** `<datalist>` sugere "Nome — CNPJ" já vistos nas notas — não precisa digitar o CNPJ de cor. Busca aceita nome parcial ou CNPJ (com ou sem pontuação).
- [x] **Etiquetas prontas e múltiplas por nota (15/06/2026):** preset `ETIQUETAS_PRESET` (Conferido, Pendente, Separado, Revisar, Divergência, Pago, Devolvido, Urgente) — usuário só clica para marcar/desmarcar, sem digitar. Campo `etiqueta` (String?) agora guarda múltiplas tags separadas por vírgula; action `alternarEtiqueta` (substitui `definirEtiqueta`) faz toggle de uma tag por vez. Tabela exibe um badge por tag; filtro de etiqueta também é multi-seleção por chips.
- [x] **Manifestação em lote (15/06/2026):** checkbox por nota RESUMO sem manifestação + "Selecionar todas pendentes" + botão "Manifestar selecionadas" com barra de progresso e resumo (manifestadas/já manifestadas/já completas/erros). Action `manifestarNotasLote` SEMPRE verifica `status`/`manifestadaEm` antes de manifestar (evita Ciência duplicada).
- [x] **Qtd. de Itens por nota (15/06/2026):** campo `qtdItens` (Int?) calculado a partir do array `det` no parser de `procNFe` (`documentos.ts`). Só preenchido em notas COMPLETA novas/re-sincronizadas; notas COMPLETA antigas mostram "—" até backfill (pendente, opcional).
- [ ] **Exportação:** Opção para exportar os dados capturados de volta para Excel/CSV se necessário.
- [ ] **API ConsultaDanfe/MeuDanfe por chave (PENDENTE):** sites de terceiros (consultadanfe.com, meudanfe.com.br) TÊM os XMLs antigos arquivados, mas o site é blindado por CAPTCHA+Cloudflare. A API oficial (token da área do cliente `app.consultadanfe.com`, possível plano grátis) seria o caminho automatizável. **Aguardando o usuário fornecer o token + doc de endpoints** para ligar no importador por chave.
- [ ] **Fallback temporário via bot no MeuDanfe (uso interno):** criar automação de navegador só como quebra-galho para NF-e sem XML local. Fluxo: procurar XML/PDF no disco/banco, se não existir abrir o MeuDanfe, consultar pela chave, baixar XML/PDF e salvar localmente para nunca repetir a busca. Requisitos: fila, rate limit, logs por chave, flag para desligar rápido e zero dependência como fluxo principal. Risco assumido: solução frágil a mudança de layout/anti-bot/termos; usar apenas até existir integração definitiva.

### Fase 4: Automação
- [ ] **Background Sync:** Criar uma tarefa agendada para buscar notas de hora em hora.
- [ ] **Notificações:** Alerta visual quando uma nota nova (ou de cancelamento) for detectada.

---

## ⚡ Fase 5: Performance e Manutenibilidade (iniciada 21/07/2026)

Diagnóstico: app funcional, mas a carga do painel e os filtros escalam mal
conforme o volume de NF cresce. Três gargalos principais + limpeza de código.
Passo a passo em ordem de esforço/risco (menor → maior):

### Etapa 1 — Ganhos rápidos (baixo risco)
- [ ] **1.1 Índices no Postgres:** `NotaFiscal` só tinha `chave @unique`. Adicionar
  índices compostos para as colunas usadas em filtro/ordenação (`cnpjId`+`emitidaEm`,
  `cnpjId`+`sitramDaeStatus`, `cnpjId`+`status`+`manifestadaEm`). Aplicar com
  `prisma db push`. Ganho direto nos `count`/`findMany`/`aggregate` do resumo.
- [ ] **1.2 Remover `axios`:** dependência declarada no `package.json` mas **não
  usada em nenhum arquivo** (o SITRAM já usa `fetch` nativo). Remover reduz bundle
  e superfície de deps.

### Etapa 2 — Paginação real do painel (médio risco)
- [ ] **2.1 Parar de carregar TODAS as notas:** `app/page.tsx` chama
  `listarTodasNotas()` (findMany sem limite) e serializa tudo para o cliente em toda
  visita. Trocar pela base paginada `listarNotasRelatorio()` (já existe, com `select`
  enxuto) e mover a busca "sobre todas as notas" para query server-side por termo.

### Etapa 3 — Frontend mais leve (médio risco)
- [ ] **3.1 Virtualizar listas grandes** com TanStack Virtual (renderiza só o visível).
- [ ] **3.2 Quebrar `dashboard.tsx`** (5.254 linhas, 1 client component) em componentes
  por aba; converter partes estáticas em Server Components para reduzir o JS enviado.
- [ ] **3.3 Quebrar `actions.ts`** (2.944 linhas) em `actions/notas.ts`,
  `actions/sitram.ts`, `actions/certificado.ts`, etc.

> Regra: cada etapa é testável isolada. Buildar (`npm run build`) e validar o
> painel antes de avançar para a próxima.

---

## 📚 Referência de Produto: FSist "Monitor de Notas" (estudado em 12/06/2026)

App instalado em `C:\Users\diarl\AppData\Roaming\FSist Sistemas Online\Monitor de Notas` que faz o que queremos. Aprendizados extraídos do `Empresas.dat` (JSON) e `user.config`:

- **NSU separado por tipo de documento:** `ultNSU`/`maxNSU` independentes para NFe e CTe (nosso schema só tem um — considerar na Fase 2).
- **Códigos de status da SEFAZ (cStat):** `138` = documentos localizados; `137` = nenhum documento; `656` = "consumo indevido" (rate limit da SEFAZ — bloqueia por ~1h; o FSist grava `AguardeAte` e só tenta de novo depois). **Obrigatório tratar o 656 na Fase 2.**
- **Busca automática:** intervalo padrão de 60 minutos (`MinutosEsperar=60`) — bate com nossa Fase 4.
- **Ciência automática:** flag opcional por empresa (`CienciaAutomatica`) — manifestação não deve ser forçada, é escolha do usuário.
- **Certificado do repositório do Windows:** usa número de série + provider (sem arquivo .pfx). O certificado da MATRIZ serve para consultar TODAS as filiais da mesma raiz de CNPJ.
- **Estado por empresa:** `Situacao` (texto livre, "OK" ou mensagem de erro), `UltimaBuscaComSucesso`, `Progresso` (0-100), contagem de notas novas.

### Dados reais do usuário (extraídos do FSist)
- 4 CNPJs NEWSHOP COMERCIO LTDA (raiz 45.998.339), todos UF CE — já cadastrados no nosso banco.
- Certificados e-CNPJ A1 no repositório do Windows (CurrentUser\My), um por filial; o da matriz (série `6D9674ABEDAE124D`, válido até 29/04/2027) é o usado pelo FSist para todas.

---

## ⚠️ Descoberta Crítica (12/06/2026): ACBrMonitorPLUS gratuito é só DEMO

A versão de download livre do ACBrMonitorPLUS (fórum ACBr) é **travada em homologação por compilação** e expira a sessão a cada 1 hora. A versão de produção exige assinatura **ACBr PRO** (paga). Confirmado empiricamente: certificado e UF funcionam, mas `tpAmb` fica fixo em 2 (homologação) independente de qualquer configuração.

**Caminho recomendado:** integração direta com a SEFAZ em Node.js (como o FSist faz em .NET):
- `DistribuicaoDFe` é SOAP sobre mTLS (certificado A1) — **não exige assinatura XML**.
- Manifestação (evento 210210) exige assinatura XML (resolvível com `xml-crypto`).
- Certificado A1 do usuário já está no repositório do Windows (exportável para .pfx).
- Elimina a dependência do ACBr por completo (custo zero de verdade).

---

## 🛠️ Requisitos Técnicos
- ~~**Software Auxiliar:** ACBrMonitorPlus~~ (DEMO limitada a homologação — ver Descoberta Crítica acima).
- **Certificado Digital:** A1 (recomendado) ou A3.
- **Ambiente:** Node.js 20+, Windows.

---

## Backlog: Navegacao, Relatorios e Dashboard Gerencial

- [ ] **Reorganizar menu por secoes:** Home, Nota Fiscal, Pagamento/SITRAM, Relatorios, Configuracao, Empresa e Usuario. Objetivo: tirar a cara de botoes soltos e deixar o app com estrutura de sistema.
- [ ] **Dashboard executivo:** total de NF, valor total, notas novas, notas sem pagamento/DAE, notas por status SEFAZ, certificados perto de vencer e ultimas sincronizacoes.
- [ ] **Mapa do Brasil por UF:** estado destacado por quantidade de NF e valor total emitido/recebido por UF. Comecar com `emitenteUf`; depois permitir alternar para `destUf`.
- [ ] **Relatorio por Estado:** ranking de UF com quantidade, valor, ticket medio, maiores fornecedores e filtros por empresa, periodo, status, pagamento e SITRAM.
- [ ] **Relatorio por Empresa/CNPJ:** comparar matriz/filiais por total de NF, valor, fornecedores, pendencias SEFAZ/SITRAM e certificados.
- [ ] **Relatorio de Fornecedores:** top fornecedores por valor/quantidade, recorrencia mensal e notas canceladas/denegadas.
- [ ] **Relatorio Financeiro/Fiscal:** DAE pago/em aberto, vencimentos, anexos/comprovantes, valores por mes e exportacao CSV/Excel/PDF.
- [ ] **Configuracoes:** separar Empresa, Usuarios, Certificados, SEFAZ/SITRAM, Preferencias e Auditoria/Logs.

---

## Plano de completude operacional (04/08/2026)

Objetivo: transformar o DanfeCollector em uma central diaria de acompanhamento de NF-e, com pendencias claras, busca rapida e rastreabilidade.

### Entregue nesta etapa
- [x] **Busca rapida global na Home:** localizar por numero, chave, fornecedor, destinatario ou CNPJ e abrir a nota ja filtrada.
- [x] **Fila visual de pendencias:** Home com XML completo pendente e SITRAM sem consulta, alem de manifestacao e DAE.
- [x] **Filtro SITRAM "Sem consulta":** atalho operacional para encontrar notas que ainda precisam de atualizacao fiscal.
- [x] **Alertas ja disponiveis:** DAE em aberto/vencido e certificado vencido/proximo do vencimento.
- [x] **Relatorios gerenciais existentes:** filtros por empresa, periodo, UF, fornecedor, risco e DAE, com exportacao de transporte em Excel.

### Proximas entregas prioritarias
- [ ] **Fila de trabalho persistente:** responsavel, status operacional, prazo e observacao por NF; permitir que a equipe acompanhe quem esta tratando cada pendencia.
- [ ] **Notificacoes:** resumo diario e alertas de novas notas, cancelamentos, DAE vencido, XML pendente e certificado proximo do vencimento.
- [ ] **Historico/auditoria:** registrar usuario, data, acao e antes/depois para etiquetas, manifestacao, pagamento, anexos e alteracoes de status.
- [x] **Relatorios fiscais prontos:** CSV de notas, pendencias e fornecedores; impressao/salvar PDF respeitando os filtros; Excel de transporte mantido.
- [x] **Worker SEFAZ resiliente:** processo persistente/reiniciavel, falha isolada por CNPJ, `maxNSU` persistido a cada resposta e estado de sincronizacao incompleta identificado.
- [x] **Saude da sincronizacao:** alerta visual para worker parado, empresa sem consulta recente e ultima execucao do ciclo.
- [x] **Conferencia por chave:** administrador pode conferir uma amostra de ate 20 notas dos ultimos 2 dias diretamente na SEFAZ, sem alterar NSU ou manifestar.
- [ ] **Saude por empresa:** ultima sincronizacao, bloqueio SEFAZ, quantidade de notas novas, erros, XML pendente e certificado.
- [ ] **Painel de lacunas:** dias sem NF, sequencias faltantes por empresa/serie e comparacao futura com ERP.

Regra de execucao: concluir a fila persistente e a auditoria antes de adicionar novas integracoes externas. Validar cada item com build e teste do fluxo visivel na Home/Nota Fiscal.

## Radar: divergencia ERP x SEFAZ no intervalo 09/07/2026 a 14/07/2026

- [ ] **Investigar salto de datas no app:** usuario relatou que o DanfeCollector pula de 09/07/2026 para 14/07/2026, mas o ERP mostra NFs em 10/07, 12/07 e 13/07.
- [ ] **Exemplos citados para conferencia:** Newshop Loja `45998339000167` NFs `1697`, `1699`, `1700`, `1701`, `1702`, `1703`, `1705`, `1706`-`1715`; Newshop CD `45998339000400` NFs `255`-`261`; fornecedores externos como ARTPEL `27020`, BIG FORTUNE `55394`, ROJEMAC `328913`, TECNO `157490`, LEHMOX `40460`.
- [ ] **Hipoteses a validar:** ERP pode estar exibindo notas de entrada/recebimento ainda sem distribuicao completa na SEFAZ; app pode estar filtrando por ano/paginacao/data carregada; NSU pode ter pulado ou ficado preso apos consumo indevido 656; algumas NFs podem estar como emitidas contra filial diferente ou ainda so em resumo.
- [ ] **Proximo diagnostico tecnico:** criar/rodar uma checagem por CNPJ + numero + data para procurar no banco local/VPS, comparar por `emitenteCnpj`, `destCnpj`, `numero`, `emitidaEm`, `chave`, `ultimoNSU` e status; se nao existir, testar consulta por chave/XML do ERP quando a chave estiver disponivel.
- [ ] **Produto futuro:** tela de "Radar de lacunas" mostrando dias sem NF, sequencias faltantes por empresa/serie/numero, e comparacao ERP x SEFAZ quando houver importacao de relatorio do ERP.
