# Vercel + Supabase Storage

O projeto usa `gru1` como regiao preferencial das Server Functions. Configure estas variaveis somente no ambiente **Server** da Vercel (Production e Preview, quando necessario):

```env
# Banco PostgreSQL pelo pooler TLS do Supabase; nunca exponha a porta 5432 direta.
DATABASE_URL="postgresql://..."
AUTH_SECRET="minimo-32-caracteres-aleatorios"

# Token restrito ao schema/buckets do Danfe; nao usar prefixo NEXT_PUBLIC_.
DANFE_SUPABASE_URL="https://db.newgrup.cloud"
DANFE_SUPABASE_KEY="jwt-da-role-danfe_api"

# Opcionais: estes sao os valores padrao do adaptador.
DANFE_STORAGE_XML_BUCKET="danfe-xml"
DANFE_STORAGE_ANEXOS_BUCKET="danfe-anexos"
DANFE_STORAGE_READ_TIMEOUT_MS="20000"
```

Nao cadastrar na Vercel `SUPABASE_SERVICE_ROLE_KEY`, `CERT_PFX_*`, certificados PFX ou segredos do cron. Eles ficam apenas no worker fiscal/VPS. O adaptador le primeiro o Storage privado e cai no disco local enquanto houver objetos ainda nao migrados.

Com essas variaveis, novos XMLs e anexos sao gravados no Storage e no disco quando ambos estao disponiveis. Se o Storage configurado falhar, a operacao falha em vez de registrar uma copia apenas no filesystem efemero da Vercel. Sem elas, o comportamento continua somente em disco. O worker fiscal continua responsavel pelo certificado PFX e pela comunicacao com a SEFAZ. Antes de apontar `danfe.newgrup.cloud` para a Vercel, valide login, DANFE, anexo e relatorio com um objeto ja migrado.
