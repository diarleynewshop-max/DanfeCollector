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
| Processo | pm2 `danfecollector` + `danfecollector-sync-nf` (auto-start systemd `pm2-danfe`) |
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
  pm2 restart danfecollector && pm2 start ecosystem.config.cjs --only danfecollector-sync-nf && pm2 save'
```
> O worker `danfecollector-sync-nf` permanece ativo, chama a rota interna `/api/internal/sync-nf` a cada 15 minutos e o PM2 o reinicia se cair. Isso evita depender de abrir o dashboard para sincronizar NF.

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
