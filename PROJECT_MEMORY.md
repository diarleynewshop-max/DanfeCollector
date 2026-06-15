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
- [ ] **Exportação:** Opção para exportar os dados capturados de volta para Excel/CSV se necessário.
- [ ] **API ConsultaDanfe/MeuDanfe por chave (PENDENTE):** sites de terceiros (consultadanfe.com, meudanfe.com.br) TÊM os XMLs antigos arquivados, mas o site é blindado por CAPTCHA+Cloudflare. A API oficial (token da área do cliente `app.consultadanfe.com`, possível plano grátis) seria o caminho automatizável. **Aguardando o usuário fornecer o token + doc de endpoints** para ligar no importador por chave.

### Fase 4: Automação
- [ ] **Background Sync:** Criar uma tarefa agendada para buscar notas de hora em hora.
- [ ] **Notificações:** Alerta visual quando uma nota nova (ou de cancelamento) for detectada.

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
