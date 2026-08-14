# DanfeCollector - Fluxo SEFAZ, XML, DANFE e SITRAM

Este documento descreve como o DanfeCollector busca NF-e na SEFAZ, baixa XML, manifesta notas, gera DANFE e consulta o SITRAM. A referencia aqui e o funcionamento atual do codigo.

## 1. Visao geral

O sistema trabalha com tres fontes principais:

1. **SEFAZ Ambiente Nacional - Distribuicao DFe**
   - Busca notas por CNPJ usando NSU.
   - Retorna `resNFe`, `procNFe` e eventos.
   - Exige certificado A1 do CNPJ interessado ou da mesma raiz.

2. **SEFAZ Ambiente Nacional - Recepcao de Evento**
   - Envia manifestacao do destinatario, principalmente `210210 - Ciencia da Operacao`.
   - Necessaria para liberar XML completo quando a SEFAZ entregou apenas resumo.

3. **SITRAM SEFAZ-CE**
   - Consulta situacao fiscal/transito/DAE de NF-e fora do CE.
   - Consulta por NF-e modelo 55 via portal.
   - Consulta por MDF-e modelo 58 via API de transportadora.

O banco guarda o estado de cada empresa em `Cnpj` e de cada nota em `NotaFiscal`. O XML/PDF fica em disco, nao dentro do banco.

## 2. Certificado digital

Arquivo principal: `src/lib/sefaz/certificado.ts`.

O sistema usa certificado A1 `.pfx`. Para operacoes na SEFAZ, o certificado e convertido para PEM em `src/lib/sefaz/assinatura.ts`.

Ordem de resolucao do certificado quando existe CNPJ informado:

1. `CERT_PFX_PATH_<CNPJ>` e `CERT_PFX_PASSWORD_<CNPJ>`.
2. `CERT_PFX_PATH_RAIZ_<RAIZ>` e `CERT_PFX_PASSWORD_RAIZ_<RAIZ>`.
3. `CERT_PFX_PATH_ROOT_<RAIZ>` e `CERT_PFX_PASSWORD_ROOT_<RAIZ>`.
4. `CERT_PFX_PATH` e `CERT_PFX_PASSWORD`.
5. Arquivos `.pfx` em `certs/`, tentando inferir senha se o nome contem `Senha_...` ou `SENHA ...`.

Regra critica: certificado exato do CNPJ tem prioridade. Se nao existir, aceita certificado da mesma raiz de 8 digitos.

Cuidados:

- Nunca commitar `.pfx` ou senha.
- Na VPS, o arquivo precisa existir dentro de `certs/` ou estar apontado corretamente no `.env`.
- Cada grupo empresarial com raiz diferente precisa do proprio certificado.
- Se trocar certificado, limpar cache ou reiniciar o processo Node/PM2.
- Certificado vencido, senha errada ou raiz divergente quebra SEFAZ e pode quebrar SITRAM.

## 3. Busca de NF-e na SEFAZ por NSU

Arquivos principais:

- `src/lib/actions.ts` - `sincronizarNotas`, `sincronizarCnpjsAtivos`.
- `src/lib/sefaz/distribuicao.ts` - montagem SOAP e parse do retorno.
- `src/lib/sefaz/documentos.ts` - interpretacao/gravação dos XMLs.

Endpoint producao:

```txt
https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
```

Endpoint homologacao:

```txt
https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx
```

Servico usado:

```txt
nfeDistDFeInteresse
```

Consulta por fila NSU:

```xml
<distDFeInt versao="1.01">
  <tpAmb>1</tpAmb>
  <cUFAutor>23</cUFAutor>
  <CNPJ>00000000000000</CNPJ>
  <distNSU>
    <ultNSU>000000000000000</ultNSU>
  </distNSU>
</distDFeInt>
```

Fluxo:

1. Usuario chama sincronizacao de uma empresa ou de todos os CNPJs ativos.
2. O sistema valida login e permissao do usuario.
3. Busca `Cnpj.ultimoNSU` no banco.
4. Se `Cnpj.bloqueadoAte` ainda estiver no futuro, nao consulta a SEFAZ.
5. Monta SOAP `distNSU` com `ultNSU`.
6. Envia via HTTPS mutual TLS com certificado A1.
7. Recebe `retDistDFeInt`.
8. Descompacta cada `docZip` com base64 + gzip.
9. Processa os documentos retornados.
10. Atualiza `ultimoNSU`, `maxNSU`, `ultimaBusca`, `situacao` e `bloqueadoAte`.

Codigos principais:

- `138`: documentos localizados.
- `137`: nenhum documento novo.
- `656`: consumo indevido. O sistema bloqueia nova tentativa por 65 minutos e persiste o `ultNSU` retornado.

Limites implementados:

- Maximo de `50` lotes por sincronizacao.
- Cada lote costuma trazer ate cerca de `50` documentos.
- Capacidade por execucao: aproximadamente `2500` documentos.
- Depois de ficar em dia, o sistema trava nova consulta por `60` minutos.
- Em `656`, trava por `65` minutos para respeitar margem operacional.

Cuidados:

- Nao resetar `ultimoNSU` para `0` sem motivo. Isso pode causar consumo indevido e reprocessamento.
- Nao remover `bloqueadoAte` manualmente para forcar consulta repetida. Use isso apenas apos manifestacao ou recuperacao controlada.
- O limite de 1 consulta/hora e especialmente importante quando nao ha documentos novos.
- `cUFAutor` vem da UF cadastrada no CNPJ. UF errada gera falha ou retorno inconsistente.

## 4. Tipos de XML recebidos

Arquivo principal: `src/lib/sefaz/documentos.ts`.

### `resNFe`

Resumo de NF-e. Vem antes da manifestacao ou quando o interessado ainda nao tem direito ao XML completo.

Dados gravados:

- chave;
- NSU;
- data de emissao;
- tipo de operacao;
- emitente;
- valor total;
- status `RESUMO`;
- situacao `AUTORIZADA`;
- caminho do XML `*-res.xml`.

Limitacoes:

- Nao tem itens.
- Nao tem todos os dados de destinatario.
- Nao permite DANFE completa.
- Precisa de manifestacao para tentar liberar `procNFe`.

### `procNFe`

XML completo da NF-e autorizada.

Dados gravados:

- chave;
- numero;
- serie;
- data;
- natureza;
- emitente;
- destinatario;
- valores;
- frete;
- transportadora;
- quantidade de itens;
- situacao SEFAZ;
- status `COMPLETA`;
- caminho do XML `.xml`.

Quando o banco ja tem a nota como `RESUMO` e chega `COMPLETA`, o registro e promovido sem duplicar a chave.

### Eventos

Eventos nao viram nota nova, mas alguns alteram estado:

- `210210 - Ciencia da Operacao`: marca `manifestadaEm` quando foi emitida pelo mesmo CNPJ.
- `110111 - Cancelamento`: marca `situacaoSefaz = CANCELADA`.

Outros eventos sao salvos no disco para auditoria com nome baseado no NSU/schema.

## 5. Manifestacao para liberar XML completo

Arquivos principais:

- `src/lib/actions.ts` - `manifestarNota`, `manifestarNotasLote`.
- `src/lib/sefaz/manifestacao.ts`.
- `src/lib/sefaz/assinatura.ts`.

Endpoint producao:

```txt
https://www1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx
```

Endpoint homologacao:

```txt
https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx
```

Evento padrao:

```txt
210210 - Ciencia da Operacao
```

Eventos conhecidos no codigo:

- `210210`: Ciencia da Operacao.
- `210200`: Confirmacao da Operacao.
- `210220`: Desconhecimento da Operacao.
- `210240`: Operacao nao Realizada.

Fluxo:

1. Usuario solicita manifestacao.
2. Sistema valida se a nota existe.
3. Se a nota ja esta `COMPLETA`, nao manifesta.
4. Se `manifestadaEm` ja esta preenchido, nao manifesta de novo.
5. Monta XML `evento`.
6. Assina o elemento `infEvento` com RSA-SHA1 e C14N.
7. Envia SOAP para `NFeRecepcaoEvento4`.
8. Trata como sucesso os cStat `135`, `136` e `573`.
9. Preenche `manifestadaEm`.
10. Limpa `bloqueadoAte` do CNPJ e sincroniza de novo para tentar baixar o XML completo.
11. Se o XML ainda nao veio, agenda nova tentativa em cerca de 5 a 6 minutos.

Cuidados:

- Ciencia da Operacao deve ser tratada como evento unico. Nao tentar enviar repetidamente.
- `573` significa evento ja registrado e e tratado como sucesso idempotente.
- XML completo pode nao aparecer imediatamente. A SEFAZ pode demorar alguns minutos.
- Manifestar nota errada pode gerar responsabilidade fiscal. Usar em lote apenas com filtro confiavel.

## 6. Consulta por chave na SEFAZ

Arquivos principais:

- `src/lib/actions.ts` - `importarChavesLote`.
- `src/lib/sefaz/distribuicao.ts` - `consultarPorChave`.

Consulta usada:

```xml
<consChNFe>
  <chNFe>00000000000000000000000000000000000000000000</chNFe>
</consChNFe>
```

Diferenca para `distNSU`:

- Nao depende do `ultimoNSU`.
- Consulta uma chave especifica.
- Ajuda em importacao de chaves vindas de Excel, ERP ou relatorio.
- Ainda depende de certificado e direito do CNPJ interessado.

Fluxo de importacao por chave:

1. Usuario cola chaves de 44 digitos.
2. Seleciona a empresa destinataria/interessada.
3. O front processa em lotes de 8 chaves.
4. Para cada chave, chama `consultarPorChave`.
5. Se vier `procNFe`, salva como `COMPLETA`.
6. Se vier `resNFe` e a opcao estiver ativa, manifesta e consulta de novo.
7. Se ainda nao vier completa, marca como `manifestada` e orienta aguardar.

Status retornados:

- `completa`;
- `resumo`;
- `manifestada`;
- `ja-tinha`;
- `nao-encontrada`;
- `fora-de-prazo`;
- `erro`.

Limitacao importante:

- Retorno `632` e tratado como `fora-de-prazo`, normalmente nota antiga fora da janela de distribuicao da SEFAZ. Para esse caso, a solucao correta e importar XML local do contador/ERP.

## 7. Importacao local de XML

Arquivo principal: `src/lib/actions.ts` - `importarXmlsDaPasta`.

Uso:

- Importar XMLs antigos.
- Recuperar notas fora da janela de distribuicao.
- Alimentar banco sem chamar SEFAZ.

Fluxo:

1. Admin informa uma pasta local.
2. O sistema varre `.xml` de forma recursiva.
3. Aceita apenas XML contendo `nfeProc`, `procNFe` ou `resNFe`.
4. Tenta associar o XML a uma empresa cadastrada pelo CNPJ do emitente ou destinatario presente no XML.
5. Salva ou promove a nota usando a mesma rotina de processamento de documentos.

Cuidados:

- Se o CNPJ da empresa nao estiver cadastrado, o XML cai em `semEmpresa`.
- XML que nao e NF-e valida e ignorado.
- Caminhos absolutos podem mudar entre Windows e VPS. O helper `resolverXmlPath` tenta reconstruir usando a pasta `downloads`.

## 8. Armazenamento de XML e PDF

XMLs ficam em:

```txt
DOWNLOAD_PATH/<cnpj>/<ano>/<mes>/
```

Padrao local se `DOWNLOAD_PATH` nao estiver definido:

```txt
./downloads
```

Nomes:

- Resumo: `<chave>-res.xml`.
- Completo: `<chave>.xml`.
- Evento/auditoria: `NSU-<nsu>-<schema>.xml`.
- DANFE PDF: `<chave>-danfe.pdf`.

O banco guarda o caminho em:

- `NotaFiscal.xmlPath`;
- `NotaFiscal.pdfPath`.

Cuidados:

- Backup precisa incluir banco e pasta `downloads`.
- Migracao Windows -> Linux pode invalidar caminho absoluto antigo. `resolverXmlPath` tenta reconstituir pelo trecho apos `/downloads/`.
- Sem XML no disco, a tela de DANFE/itens nao funciona mesmo que a nota exista no banco.

## 9. DANFE e PDF

Rotas internas:

```txt
/danfe/[chave]
/danfe/[chave]/pdf
```

`/danfe/[chave]`:

- exige login;
- valida permissao do usuario no CNPJ da nota;
- exige nota `COMPLETA`;
- le XML do disco;
- parseia `procNFe`;
- renderiza DANFE em HTML no formato de folha para impressao;
- o fluxo principal para baixar PDF agora e abrir essa rota e usar `Ctrl+P`.

`/danfe/[chave]/pdf`:

- mantida apenas por compatibilidade;
- redireciona para `/danfe/[chave]`.

Cuidados:

- A DANFE impressa passa a depender so do HTML interno do sistema e do dialogo de impressao do navegador.
- Nunca mandar resumo `resNFe` para DANFE completa.

## 10. SITRAM - consulta por NF-e

Arquivos principais:

- `src/lib/actions.ts` - `atualizarSitramPorChaves`, `listarChavesSitramParaAtualizacao`, `salvarRetornoSitramPorNfe`.
- `src/lib/sitram/portal.ts`.
- `src/lib/sitram/dae.ts`.

Base URL padrao:

```txt
https://portal-sitram.sefaz.ce.gov.br
```

Rotas externas:

```txt
GET /api-nota/notafiscal/por-chave-de-acesso/{chave}?page=0&size=25
GET /api-nota/notafiscal/lancamentos-nota-fiscal/{idNotaFiscal}
GET /api-nota/notafiscal/itens-nota-fiscal/{idNotaFiscal}?page=0&size=100
GET /api-calculadora/{idItemSitram}
```

Fluxo:

1. Sistema recebe chave de NF-e modelo `55`.
2. Consulta o portal por chave.
3. Se nao encontrar, marca a nota como `NAO_ENCONTRADA`.
4. Se retornar mais de um registro, usa o mais recente por `dataInclusao`, `dataFatoGerador`, `dataEmissao` ou `id`.
5. Se existir `id` da nota no SITRAM, consulta lancamentos e itens da nota.
6. Para cada item, consulta a Calculadora de ICMS e grava a trilha retornada pelo SITRAM. O identificador do item deve ser mantido como texto, pois excede o inteiro seguro do JavaScript.
7. Atualiza a nota no banco com status de selagem, situacao, DAE, itens e detalhe JSON.

Campos atualizados:

- `sitramConsultadaEm`;
- `sitramChaveManifesto`;
- `sitramAcaoFiscal`;
- `sitramSelada`;
- `sitramSituacao`;
- `sitramDaeStatus`;
- `sitramDaeResumo`;
- `sitramDaeUrl`;
- `sitramDetalhe`, com `notaFiscal`, `lancamentos`, `itens` e a trilha `calculadoraSitram` de cada item.

Uso do espelho SITRAM:

- O sistema pode montar `/danfe-sitram/{chave}` com dados do SITRAM para impressao via `Ctrl+P`.
- Esse documento e um espelho operacional, nao substitui o DANFE oficial do XML `procNFe`.
- Para notas antigas ja consultadas antes desta melhoria, e preciso reconsultar o SITRAM para preencher `itens` e `calculadoraSitram`.
- O espelho classifica cada item diretamente pela receita da calculadora: `1031 - SUBT`, `1023 - ANTC`, ou `Sem ST/ANT`; FECOP usa a receita `2020`/valor individual quando informado.

Status DAE normalizados:

- `PAGO`;
- `EM_ABERTO`;
- `SEM_DAE`;
- `CONSULTADO`;
- `NAO_ENCONTRADA`;
- `LIBERADA_PARA_GERAR` em alguns fluxos antigos/API.

Cuidados:

- O portal pode retornar mais de um registro para a mesma NF-e. O sistema grava apenas o mais recente.
- `NAO_ENCONTRADA` nao significa erro da NF-e; pode significar que a nota nao passou pelo fluxo SITRAM.
- O status manual de pagamento (`pagamentoManualEm`) tem prioridade sobre o status retornado pelo SITRAM.
- Lancamento FECOP codigo `2020` e ocultado na visualizacao normal de DAE.
- A trilha da Calculadora de ICMS e a fonte primaria para ST, ANTC, FECOP, base e ICMS por item. Os lancamentos da nota sao somente contingencia quando a calculadora individual nao responder.

## 10.1. SITRAM - pagamento ICMS / DAE por NF-e

Arquivos principais:

- `src/lib/sitram/pagamento-icms-portal.ts`.
- `src/lib/sitram/dae.ts`.
- `src/lib/actions.ts` - `consultarPagamentoIcmsNota`.

Rotas externas confirmadas:

```txt
GET  /api-pagamento/dae/buscarNumeroDae?idLancamento={idLancamentoFront}
POST /api-pagamento/dae/informacoes-documentos/batch
GET  /api-pagamento/dae/simularDaeNotaFiscal?idsLancamento={idLancamentoFront}
POST /api-pagamento/pagamento/dae
```

Fluxo implementado:

1. A nota precisa ter lancamentos SITRAM em `sitramDetalhe.lancamentos`.
2. O sistema usa `idLancamentoFront`, nao o `id` interno, para consultar documentos DAE.
3. Se existir `DAE PAGO`, o status efetivo passa a ser `PAGO`.
4. Se existir `DAE EMITIDO`, o sistema guarda codigo do documento, validade e codigo de barras quando retornado.
5. Se nao existir documento emitido e houver lancamento em aberto, o sistema faz simulacao para mostrar valor/vencimento.

Cuidados:

- IDs do SITRAM sao maiores que o limite seguro de `number` em JavaScript; devem ser tratados como string.
- A emissao real de DAE (`/dae/emitir-dae`) nao deve rodar automaticamente. Deve ser um clique explicito do usuario, pois cria documento de arrecadacao.
- A API confirmada retorna codigo de barras do DAE; QR Code so deve ser exibido se o SITRAM retornar esse dado em endpoint especifico ou PDF oficial.

## 11. SITRAM - consulta por MDF-e

Arquivos principais:

- `src/lib/actions.ts` - `atualizarSitramPorManifestos`, `salvarRetornoSitram`.
- `src/lib/sitram/client.ts`.

Base URL padrao:

```txt
https://api.sefaz.ce.gov.br/service-transportadora-sitram
```

Rotas externas:

```txt
GET /manifesto-carga/{chaveMdfe}
GET /gerar-dae/{key}
GET /situacao/nota-fiscal
GET /situacao/conhecimento-transporte
GET /situacao/acao-fiscal
```

Autenticacao:

- O codigo extrai o certificado publico do `.pfx`.
- Remove header/footer PEM.
- Envia como:

```txt
Authorization: Bearer <certificado-publico-base64>
```

Fluxo por MDF-e:

1. Usuario informa chave modelo `58`.
2. Sistema chama `/manifesto-carga/{chave}`.
3. O retorno traz notas fiscais vinculadas ao manifesto.
4. Para cada NF-e vinculada, tenta localizar no banco por chave.
5. Atualiza campos SITRAM/DAE das notas encontradas.
6. Informa quantas notas do manifesto nao estavam no banco.

Cuidados:

- Essa API depende do certificado estar autorizado para o servico/CNPJ.
- `401` ou `403` sao tratados como certificado nao autorizado ou CNPJ sem permissao.
- MDF-e pode conter NF-e que ainda nao foram importadas no DanfeCollector.
- A consulta por NF-e modelo `55` hoje usa o portal; a consulta por MDF-e modelo `58` usa a API de transportadora.

## 12. Atualizacao diaria NF + SITRAM

Arquivo principal: `app/dashboard.tsx`.

A rotina automatica roda no navegador quando o dashboard e aberto entre 06:00 e 12:00.

Controle local:

```txt
localStorage: danfe-rotina-matinal:YYYY-MM-DD
```

Fluxo:

1. Chama `sincronizarCnpjsAtivos`.
2. Depois chama atualizacao diaria do SITRAM.
3. A atualizacao SITRAM busca pendencias pelo ano selecionado.
4. Processa chaves em lotes de 5.
5. Pausa 200 ms entre lotes.
6. Atualiza a tela ao final.

Selecao de notas para SITRAM diario:

- `status = COMPLETA`;
- `situacaoSefaz` diferente de `CANCELADA` e `DENEGADA`;
- `sitramConsultadaEm` nulo ou anterior ao inicio do dia local;
- ano de emissao selecionado;
- emitente fora do CE;
- emitente UF nao nula;
- chave modelo `55`.

Cuidados:

- A rotina automatica depende de alguem abrir o dashboard no periodo da manha.
- O bloqueio SEFAZ por CNPJ continua sendo respeitado.
- SITRAM e atualizado no maximo uma vez por dia por nota elegivel, salvo consulta manual.
- Se o navegador limpou `localStorage`, a rotina pode tentar rodar de novo, mas a SEFAZ ainda sera protegida por `bloqueadoAte`.

## 13. Rotas internas da aplicacao

Rotas HTTP Next.js:

```txt
/login
/
/?page=N
/danfe/[chave]
/danfe/[chave]/pdf
/danfe/[chave]/anexo/[anexoId]
```

Server actions importantes:

- `verificarCertificado`: valida PFX e senha.
- `enviarCertificadoVps`: grava PFX, atualiza `.env`, limpa cache.
- `sincronizarNotas`: busca DFe por CNPJ/NSU.
- `sincronizarCnpjsAtivos`: roda busca em todos os CNPJs ativos.
- `manifestarNota`: manifesta uma nota.
- `manifestarNotasLote`: manifesta varias notas.
- `importarChavesLote`: consulta SEFAZ por chave.
- `importarXmlsDaPasta`: importa XML local.
- `obterDetalheNota`: le XML completo e monta DANFE/itens.
- `listarChavesSitramParaAtualizacao`: seleciona NF-e fora do CE para atualizar SITRAM.
- `atualizarSitramPorChaves`: decide entre NF-e modelo 55 e MDF-e modelo 58.
- `atualizarSitramPorManifestos`: consulta MDF-e no SITRAM.
- `previewPagamentoSitram`: le PDF de relacao de pagamento SITRAM.
- `aplicarPagamentoSitram`: marca pagamento manual.

## 14. Modelo de dados relevante

Tabela `Cnpj`:

- `cnpj`;
- `uf`;
- `ultimoNSU`;
- `maxNSU`;
- `ativo`;
- `situacao`;
- `ultimaBusca`;
- `bloqueadoAte`;
- dados de certificado.

Tabela `NotaFiscal`:

- chave/numero/serie/data;
- emitente/destinatario;
- valores/frete/transportadora;
- `status`: `RESUMO` ou `COMPLETA`;
- `situacaoSefaz`: `AUTORIZADA`, `CANCELADA`, `DENEGADA`;
- campos SITRAM;
- `manifestadaEm`;
- `xmlPath`;
- `pdfPath`;
- pagamento manual.

Regra de unicidade:

- `NotaFiscal.chave` e unica. Nao existe duplicidade de nota por empresa.

## 15. Limitacoes reais

SEFAZ:

- Limite pratico de consulta quando nao ha documentos novos: 1 por hora.
- `656` indica consumo indevido. Deve respeitar espera.
- XML completo pode depender de manifestacao.
- Manifestacao nao garante XML instantaneo.
- Notas antigas podem retornar `632`/fora de prazo na consulta por chave.
- `resNFe` nao tem itens nem DANFE completa.
- Certificado precisa ter direito sobre o CNPJ/raiz.

SITRAM:

- Pode nao encontrar NF-e mesmo que ela exista na SEFAZ.
- Pode retornar multiplos registros para a mesma chave.
- Status textual pode variar. O sistema normaliza, mas o detalhe bruto fica em JSON.
- Consulta por MDF-e pode trazer notas que nao existem no banco.
- API de transportadora exige certificado autorizado.
- Portal por NF-e pode mudar formato/contrato sem aviso.

Operacional:

- Backup incompleto sem `downloads/` deixa banco sem XML fisico.
- Troca de servidor exige revisar caminhos de XML/PDF.
- Rotina matinal depende do dashboard abrir.
- Importacao por pasta deve ser feita por admin.
- Pagamento manual sobrepoe status do SITRAM e precisa de controle humano.

## 16. Cuidados antes de alterar

Checklist minimo:

1. Nao alterar politica de `bloqueadoAte` sem entender cStat `656`.
2. Nao reenviar `210210` se `manifestadaEm` ja existe.
3. Nao resetar `ultimoNSU` em producao sem backup.
4. Nao assumir que `resNFe` tem itens ou destinatario completo.
5. Nao consultar SITRAM para nota cancelada/denegada na rotina diaria.
6. Nao mover `downloads/` sem migrar ou reconstruir `xmlPath`.
7. Nao depender apenas do banco no backup.
8. Nao publicar `.pfx`, senha ou `.env`.
9. Validar permissao do usuario antes de expor XML/PDF.
10. Em VPS, confirmar que todos os certificados por raiz estao presentes.

## 17. Diagnostico rapido

Nota nao aparece:

- Conferir CNPJ ativo.
- Conferir certificado da raiz correta.
- Conferir `ultimoNSU`, `ultimaBusca`, `bloqueadoAte`.
- Ver se a nota e antiga e precisa de importacao por XML.

Nota esta como resumo:

- Conferir `manifestadaEm`.
- Manifestar se ainda nao foi manifestada.
- Aguardar alguns minutos e sincronizar de novo.

DANFE nao abre:

- Verificar se `status = COMPLETA`.
- Verificar se `xmlPath` existe.
- Verificar se `resolverXmlPath` consegue reconstruir caminho.
- Se PDF falhar, testar HTML `/danfe/[chave]`.

SITRAM nao atualiza:

- Conferir se a nota e `COMPLETA`.
- Conferir se emitente e fora do CE.
- Conferir se nao esta cancelada/denegada.
- Conferir se `sitramConsultadaEm` ja e de hoje.
- Para MDF-e, conferir autorizacao do certificado na API SITRAM.

Erro 401/403 no SITRAM API:

- Certificado nao autorizado para o servico ou CNPJ.
- Certificado errado para a raiz.
- PFX ausente ou senha errada.

Erro 656 na SEFAZ:

- Aguardar `bloqueadoAte`.
- Nao insistir manualmente.
- Conferir se `ultimoNSU` foi persistido.

Erro 632 ou fora de prazo:

- Buscar XML com contador/ERP.
- Importar pela pasta local.
