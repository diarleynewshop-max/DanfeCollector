# atualizar.md — Publicar a versão atual do app na VPS

> **Como usar:** na conversa com o Claude, diga apenas: **"Chat, usa o atualizar.md para atualizar o app"**.
> O Claude executa este roteiro. Onde estiver marcado 👤 **VOCÊ**, ele vai te passar um comando pra colar no seu PowerShell (porque o envio de arquivos com segredos é bloqueado no modo automático).

---

## Dados fixos do ambiente (não mudam)

| Item | Valor |
|------|-------|
| URL pública | https://danfe.newgrup.cloud |
| VPS | Hostinger • Ubuntu 24.04 • IP `187.127.45.197` |
| Acesso SSH | `ssh -i ~/.ssh/newshop_vps root@187.127.45.197` (chave, sem senha) |
| Painel | CloudPanel (nginx gerenciado — **nunca editar vhost na mão**) |
| Pasta do app na VPS | `/home/danfe/htdocs/danfe.newgrup.cloud` |
| Usuário do site | `danfe` |
| Porta do app | `3100` |
| Node (nvm) | `/home/danfe/.nvm/versions/node/v22.23.1/bin` (exportar no PATH; nvm não carrega sozinho em shell não-interativo) |
| Processo | pm2 `danfecollector` + `danfecollector-sync-nf` + `danfecollector-status-erp` (auto-start systemd `pm2-danfe`) |
| Projeto local | `c:\Users\diarl\OneDrive\Documentos\GitHub\DanfeCollector` |

---

## Roteiro (Claude executa em ordem)

### 1. Empacotar o código local (Claude)
No PowerShell, a partir da pasta do projeto, rode:
```powershell
.\scripts\empacotar-danfe-vps.ps1
```
O script cria um `.tgz` no temporário do Windows e exclui somente as pastas de dados da **raiz**. Não use `--exclude=anexos` no `tar` manual: isso também pode excluir `src/lib/anexos` do código.
> ⚠️ O pacote **só leva código**. Dados, segredos e config vivem **só na VPS** e nunca são sobrescritos por deploy:
> - `prisma/dev.db` / `downloads/` / `anexos/` — dados de produção (o banco agora é PostgreSQL, ver seção abaixo; o `dev.db` é só legado)
> - `.env` — a VPS tem o seu próprio (com a `DATABASE_URL` do Postgres). O `.env` local é para desenvolvimento e **não** vai no deploy.
> - `certs/` - os certificados A1 `.pfx` ja estao na VPS e raramente mudam.
> Se recriar a VPS do zero, subir `.env` e `certs/` manualmente uma vez.
>
> **Certificados atuais:** o app escolhe o PFX por CNPJ/raiz. Newshop usa a raiz `45998339`;
> Soye usa `62803717`; Facil usa `50767035`. Na VPS, manter os `.pfx` em `certs/`
> ou configurar `CERT_PFX_PATH_<CNPJ>` / `CERT_PFX_PATH_RAIZ_<RAIZ>` no `.env`.
> Para a rotina server-side de NF, o `.env` da VPS tambem precisa ter `CRON_SYNC_SECRET`
> e, se quiser sobrescrever a rota padrao local, `CRON_SYNC_URL`.

### Subir certificado A1 para a VPS
Use quando trocar/recriar certificado ou quando a VPS for recriada. Rode no
PowerShell do PC, dentro da pasta do projeto. A senha sera pedida no prompt e o
script atualiza o `.env` da VPS sem mostrar a senha no historico:

```powershell
npm run cert:vps -- -PfxPath "C:\CAMINHO\certificado.pfx" -RaizCnpj 45998339 -Restart
```

Troque a raiz conforme a empresa:
- Newshop: `45998339`
- Soye: `62803717`
- Facil: `50767035`

Para certificado de um CNPJ exato, use:

```powershell
npm run cert:vps -- -PfxPath "C:\CAMINHO\certificado.pfx" -Cnpj 45998339000100 -Restart
```

O script salva o arquivo em `/home/danfe/htdocs/danfe.newgrup.cloud/certs/`,
grava `CERT_PFX_PATH_RAIZ_<RAIZ>` + `CERT_PFX_PASSWORD_RAIZ_<RAIZ>` no `.env`,
aplica `chmod 600` e reinicia o `pm2` quando `-Restart` for informado.

### 2. 👤 VOCÊ envia o pacote (PowerShell do PC, janela NOVA — fora da sessão SSH)
O Claude te entrega este comando já com o caminho certo. Espere aparecer `100% 12MB`:
```powershell
scp -i $HOME\.ssh\newshop_vps "<CAMINHO_DO_danfe.tgz>" root@187.127.45.197:/tmp/danfe.tgz
```

### 3. Extrair na VPS (Claude, via SSH)
Antes de extrair, preservar o legado local caso o `prisma/dev.db` ainda exista:
```bash
APP=/home/danfe/htdocs/danfe.newgrup.cloud
[ -f "$APP/prisma/dev.db" ] && cp -f "$APP/prisma/dev.db" "$APP/prisma/dev.db.bak-$(date +%Y%m%d-%H%M%S)"
tar xzf /tmp/danfe.tgz -C "$APP"
chown -R danfe:danfe "$APP"
# Reaplicar permissões restritas nos arquivos sensíveis (o tar pode reabrir):
chmod 600 "$APP/.env"
find "$APP/certs" -type f -name '*.pfx' -exec chmod 600 {} \;
[ -f "$APP/prisma/dev.db" ] && chmod 600 "$APP/prisma/dev.db"
rm -f /tmp/danfe.tgz
```

### 4. Instalar / gerar / migrar / buildar (Claude, como usuário `danfe`)
```bash
su - danfe -c 'export PATH=/home/danfe/.nvm/versions/node/v22.23.1/bin:$PATH; \
  cd /home/danfe/htdocs/danfe.newgrup.cloud && \
  npm install && npx prisma generate && npm run build'
```
> Não rode `prisma db push` neste projeto: o PostgreSQL é compartilhado com SCAN e Catálogo. Mudanças de banco do Danfe entram somente pelas migrations versionadas em `supabase/migrations/` e são aplicadas/validadas antes do deploy.

> Antes do restart, o administrador do banco deve aplicar `supabase/migrations/20260804_001_sync_worker_health.sql`. Ela cria o estado do worker usado pelos alertas da Home. Nao rode `prisma db push` neste projeto.

### 5. Reiniciar o app (Claude)
```bash
su - danfe -c 'export PATH=/home/danfe/.nvm/versions/node/v22.23.1/bin:$PATH; \
  pm2 restart danfecollector && pm2 start ecosystem.config.cjs --only danfecollector-sync-nf && \
  pm2 start ecosystem.config.cjs --only danfecollector-status-erp && pm2 save'
```
> O worker `danfecollector-sync-nf` permanece ativo, chama a rota interna `/api/internal/sync-nf` a cada 15 minutos e o PM2 o reinicia se cair. Isso evita depender de abrir o dashboard para sincronizar NF.
>
> O worker `danfecollector-status-erp` roda em segundo plano checando o ERP em lotes de 50 notas (`scripts/atualizador-status-erp-continuo.mjs`), só para notas etiquetadas "Pendente a Entrega", "Inconsistente" ou sem etiqueta ainda — ignora "Efetivada"/"Recusada" por serem status finais. Depois de terminar uma volta completa, dorme 10 min e recomeça. Se o pm2 já tiver esse processo registrado de um deploy anterior, `pm2 start ecosystem.config.cjs --only danfecollector-status-erp` apenas reinicia com a config atual (não duplica).

### 6. Verificar (Claude)
```bash
curl -s -o /dev/null -w 'app local :3100 -> HTTP %{http_code}\n' http://127.0.0.1:3100   # na VPS
curl -s -o /dev/null -w 'publico -> HTTP %{http_code}\n' https://danfe.newgrup.cloud       # do PC
```
Esperado: **HTTP 200** nos dois. Se der 502, o app não subiu → ver `pm2 logs danfecollector --lines 40`.

### 7. Verificação visual do dashboard/relatórios (Claude)
Depois do `HTTP 200`, abrir `https://danfe.newgrup.cloud/login` e validar no navegador:

- a tela `Início` deve mostrar o resumo operacional, os quatro indicadores gerais, pontos de atenção, notas recentes e atalhos;
- os cards da tela `Início` devem se reorganizar sem cortes no mobile, mantendo os valores e ações legíveis;
- a tela `Relatórios` não pode puxar tudo de uma vez; a primeira carga vem paginada e deve existir ação para carregar mais;
- a tabela do relatório deve crescer em blocos pequenos, sem travar a página;
- o mapa de estados não deve ficar com área branca sobrando em volta;
- os textos principais em português e chinês simplificado devem aparecer sem erro visível de ortografia;
- a navegação e os cards do relatório precisam responder bem no mobile.

#### Registro de publicação — 16/10/2026

- Os botões roxo e verde do alerta de DAE montam um ZIP com os PDFs retornados pelo SITRAM para os DAEs vencidos ou com vencimento nos próximos 7 dias. A confirmação informa que nenhum pagamento será realizado.
- Build local e remoto aprovados; `/login` interno e público retornaram HTTP 200, a rota ZIP sem sessão retornou 401, `danfecollector` e os dois workers ficaram online, e `pm2-danfe` permaneceu ativo.
- A geração autenticada dos PDFs não foi executada nesta publicação, pois ela pode gerar ou atualizar documentos fiscais; a solicitação ocorre após confirmação no dashboard.

#### Publicação — 21/10/2026 — consulta de pagamento ICMS

- O botão consulta uma NF por vez, grava o resultado antes de avançar e exibe uma janela com NF atual, posição do lote e totais de pagas, em aberto e erros. Falha individual não interrompe as demais notas.
- Deploy isolado de `app/dashboard.tsx`, com backup em `/home/danfe/backups/payment-progress-20261021-135045`; build executado na VPS e somente `danfecollector` reiniciado. `danfecollector-sync-nf` e `danfecollector-status-erp` permaneceram online.
- Bundle contém a nova janela; `/login` interno e público retornaram HTTP 200. Validação visual autenticada do fluxo fica pendente nesta sessão, sem navegador disponível.

---

### Conferencia SITRAM por item

Depois de reconsultar uma NF-e no SITRAM, abrir a aba `Itens` e conferir:

- `1031 - SUBT`, `1023 - ANTC` ou `Sem ST/ANT` no item correto;
- FECOP individual quando a calculadora retornar a receita `2020`;
- base e ICMS da calculadora, incluindo BC/ICMS ST ou ANTC.

---

## Se algo travar
- **scp bloqueado / "data exfiltration"**: normal no modo auto. O usuário roda o `scp` do passo 2 manualmente.
- **`node: command not found`**: esqueceu de exportar o PATH do nvm (passo 4/5).
- **Marcador `^[[200~` colado no comando**: terminal em bracketed-paste; digitar em vez de colar, ou apagar os caracteres.
- **Build falha**: rodar só o `npm run build` e ler o erro; geralmente é `.env` faltando variável ou erro de tipo.

## Banco de dados (Supabase)
Desde 29/jul/2026, o Danfe usa o schema isolado `danfe` no Supabase da VPS. SCAN e Catálogo continuam no schema `public` e não devem ser alterados por migrations do Danfe.

| Item | Valor |
|------|-------|
| Banco/schema | `postgres` / `danfe` |
| Runtime Vercel | `db.newgrup.cloud:6543`, Supavisor com TLS obrigatório |
| Porta 5432 | Somente `localhost` na VPS; nunca usar na Vercel |
| Role do app | `danfe_prisma`, limitada ao schema `danfe` |
| Segredos da VPS | `/home/danfe/.secrets/danfe_prisma_database.env` e `danfe_supabase_api.jwt` |

- Não imprimir nem commitar a `DATABASE_URL` ou a JWT do Danfe.
- Para a Vercel, configurar `DATABASE_URL`, `AUTH_SECRET`, `DANFE_SUPABASE_URL` e `DANFE_SUPABASE_KEY` conforme `docs/VERCEL_SUPABASE_STORAGE.md`.
- O PostgreSQL legado na porta `5433` permanece apenas como rollback até o corte ser validado; não receber mudanças novas.

## Backups
- **Automático:** root cron, **domingo 03:05**, `/usr/local/sbin/backup-danfe-supabase`. Salva dump do schema `danfe`, buckets `danfe-xml`/`danfe-anexos`, `downloads`, `anexos`, `.env` e certificados em `/home/danfe/backups/`. Mantém oito cópias; log em `backup-supabase.log`.
- **Baixar pro PC:** `.\scripts\baixar-backup.ps1` (use `-Novo` para gerar uma cópia na hora).
- **Backup manual:** `sudo /usr/local/sbin/backup-danfe-supabase`.
- **Restaurar:** extrair `danfe-supabase.pg.dump` e restaurar somente no schema `danfe`; recuperar os diretórios `danfe-xml` e `danfe-anexos` no Storage antes de apontar o app.

## Rollback rápido
O deploy sobrescreve **apenas o código** (dados/`.env`/certs ficam preservados na VPS). Se precisar voltar o código, reenviar um pacote de uma versão anterior e refazer passos 3–5. Para restaurar **dados**, usar o `.tgz` de backup correspondente.

#### Correção publicada — 21/10/2026 — consulta dos vencidos

- O botão de consulta sequencial foi ligado ao cabeçalho dos DAEs vencidos. Ele envia as NFs únicas que compõem os vencimentos exibidos e mantém a janela `NF x de y` atualizando uma por vez.
- Build remoto aprovado e somente `app/dashboard.tsx` publicado. Backup da fonte em `/home/danfe/backups/overdue-payment-consult-retry-20261021-150819/dashboard.tsx`; SHA-256 publicado `99de8879652df1e21a885af70ff941fa9130313cbba623be4f5e2dfa754aebfc`.
- `danfecollector` online; os workers auxiliares permaneceram online; serviço `pm2-danfe` ativo; `/login` interno e público retornaram HTTP 200. Validação visual autenticada ainda pendente.
- Consultar não baixa a contagem por si só: os 264 DAEs continuam vencidos enquanto o SITRAM os reportar em aberto. A contagem deve mudar quando o SITRAM confirmar pagamento ou o status do DAE mudar.

#### Proteção da fila de consulta — 21/10/2026

- Se a ação receber erro de rede/timeout/5xx do SITRAM ou resposta inesperada do servidor, interrompe o lote após a NF que falhou e informa quantas foram processadas, evitando repetir falhas nas demais notas.
- Diagnóstico desta tentativa: VPS sem conexão HTTPS com `portal-sitram.sefaz.ce.gov.br:443` (`UND_ERR_CONNECT_TIMEOUT`). A aplicação Danfe respondeu normalmente; não houve confirmação de pagamento nessas falhas.
- Deploy isolado de `app/dashboard.tsx`, build remoto aprovado e app reiniciado. Backup: `/home/danfe/backups/payment-consult-failfast-20261021-152528/dashboard.tsx`; SHA-256 `422d5c8b89a54a725295791942e1dcee795a62d84b7e8b046cc4b3f1c4310d57`.

#### Timeout da consulta de pagamento SITRAM — 21/10/2026

- As chamadas HTTP do SITRAM agora encerram após 30 segundos; a janela mostra a NF atual antes de aguardar a resposta, e a fila de atualização automática para após falha de comunicação.
- Publicação isolada de quatro arquivos a partir da versão presente na VPS; build de produção aprovado. Backup: `/home/danfe/backups/payment-timeouts-20261021-155155/`.
- Checksums publicados: `dashboard.tsx` `1f5922b5e71469f051c4301baf8934663f6b323489b64d8d4e9c126a30507c1b`; `actions.ts` `31b676b9d999062c82221d84936283ba791457fc9542ba5e5f1d2b233c44dc82`; `portal.ts` `1601c70c53cbc30a4c3a8c88027f8393eb0445a3d95cb95a159f2d57838fa024`; `pagamento-icms-portal.ts` `64588920ab65b10868aac03cd248447e32b241fd1f23f0c46560a3e45e6a8f77`.
- Reiniciado apenas `danfecollector`; os workers auxiliares ficaram online. `/login` interno e público retornaram HTTP 200. Consulta de pagamento/SITRAM e contagem atual dos DAEs ainda precisam de confirmação no navegador autenticado.
