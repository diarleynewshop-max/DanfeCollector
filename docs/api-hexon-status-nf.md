# API Proton-e — Recebimento de Status de NF (Hexon)

Integração **push** (webhook): o **Hexon envia** o status da nota fiscal para o Proton-e sempre que ele mudar.
O Proton-e **não consulta** o Hexon.

| Item | Valor |
|---|---|
| URL de produção | `https://danfe.newgrup.cloud/api/v1/integracoes/hexon/status-nf` |
| Método | `POST` |
| Content-Type | `application/json` (UTF-8) |
| Autenticação | Chave de API (header `Authorization: Bearer` ou `x-api-key`) |
| Tamanho máximo | 1 MB por requisição, até **100 notas** por lote |
| Timeout recomendado no Hexon | 30 s |

---

## 1. Autenticação

1. Um administrador do Proton-e cria uma chave na seção **API para terceiros** do painel, com o nome `Hexon`.
2. O token (`dc_xxxxxxxx_...`) é exibido **uma única vez** — copie e guarde no Hexon como segredo.
3. Envie o token em **um** dos headers:

```http
Authorization: Bearer dc_xxxxxxxx_SEU_TOKEN
```
```http
x-api-key: dc_xxxxxxxx_SEU_TOKEN
```

- Chave revogada ou ausente → `401`.
- Para trocar a chave: gere uma nova, atualize no Hexon e depois revogue a antiga (sem downtime).
- Nunca envie o token por query string (`?token=`) — não é aceito.

---

## 2. Payload

### 2.1 Campos de cada nota

| Campo | Tipo | Obrigatório | Regras |
|---|---|---|---|
| `chave` | string | **Sim** | Chave de acesso NF-e com 44 dígitos. Pontos, espaços e traços são removidos. |
| `status` | string | **Sim** | Status da NF no Hexon. Normalizado para **MAIÚSCULAS**, espaços duplicados removidos. Máx. 120 caracteres. |
| `atualizadoEm` | string ISO 8601 | Recomendado | Momento em que o status mudou **no Hexon** (ex.: `2026-09-14T10:30:00-03:00`). Se omitido, usa a hora do recebimento. Não pode estar mais de 5 min no futuro. |
| `atualizadoPor` | string \| null | Não | Usuário/processo que alterou o status. Padrão: `Hexon`. |
| `kanbanStatus` | string \| null | Não | Coluna/etapa do kanban, se houver. |
| `statusOperacional` | string \| null | Não | Descrição do status operacional. |
| `statusOperacionalCodigo` | string \| number \| null | Não | Código do status operacional. |

**Semântica dos campos opcionais** (`kanbanStatus`, `statusOperacional`, `statusOperacionalCodigo`):

- **Campo omitido** → mantém o valor já gravado no Proton-e.
- **Campo com `null`** ou string vazia → limpa o valor.

Campos desconhecidos são ignorados (o Hexon pode enviar campos extras sem quebrar).

### 2.2 Status recomendados

O Proton-e aceita qualquer texto, mas os status abaixo têm cor própria no painel e são tratados como etiqueta de recebimento (a etiqueta anterior é trocada automaticamente pela nova):

| Status | Cor no painel |
|---|---|
| `NF A CHEGAR` | azul |
| `AGUARDANDO CADASTRO` | âmbar |
| `AGUARDANDO PRECO` | âmbar |
| `AGUARDANDO ENVIO` | âmbar |
| `CONCLUIDO RECEBIMENTO` | verde |
| `NF ENVIADA` | verde |
| qualquer outro | índigo |

> Use exatamente esses textos (sem acento) sempre que o significado for o mesmo. Status fora da lista também funcionam, mas não recebem cor específica.

### 2.3 Nota única

```json
{
  "chave": "23260912345678000199550010000123451000123456",
  "status": "AGUARDANDO CADASTRO",
  "atualizadoEm": "2026-09-14T10:30:00-03:00",
  "atualizadoPor": "joao.silva",
  "kanbanStatus": "Cadastro",
  "statusOperacional": "Produto sem cadastro",
  "statusOperacionalCodigo": "12"
}
```

### 2.4 Lote (até 100 notas)

Basta envolver as notas em `notas`:

```json
{
  "notas": [
    { "chave": "23260912345678000199550010000123451000123456", "status": "NF A CHEGAR", "atualizadoEm": "2026-09-14T08:00:00-03:00" },
    { "chave": "23260912345678000199550010000123461000123457", "status": "CONCLUIDO RECEBIMENTO", "atualizadoEm": "2026-09-14T09:15:00-03:00" }
  ]
}
```

Se houver mais de 100 notas, divida em várias requisições.

---

## 3. Respostas

Todas as respostas são JSON. O campo `codigo` é estável e deve ser usado pelo Hexon para decidir o que fazer (não dependa do texto de `message`).

### 3.1 Nota única

| HTTP | `codigo` | Significado | Ação no Hexon |
|---|---|---|---|
| 200 | `ATUALIZADO` | Status gravado. | Marcar como entregue. |
| 200 | `SEM_ALTERACAO` | Mesmo status já estava gravado (reenvio). | Marcar como entregue. |
| 200 | `IGNORADO_DESATUALIZADO` | O Proton-e já tem um status com `atualizadoEm` **mais recente**; este foi descartado. | Marcar como entregue. **Não** reenviar. |
| 400 | `INVALIDO` | Campos inválidos — veja `erros`. | Corrigir o payload. **Não** reenviar igual. |
| 400 | `JSON_INVALIDO` / `LOTE_VAZIO` | Corpo não é JSON válido / lote vazio. | Corrigir. |
| 401 | `NAO_AUTORIZADO` | Chave ausente, errada ou revogada. | Verificar token. Alertar. |
| 404 | `NOTA_NAO_ENCONTRADA` | A NF ainda não existe no Proton-e (não foi importada da SEFAZ). | **Reenviar mais tarde** (ver §4). |
| 413 | `PAYLOAD_GRANDE` / `LOTE_GRANDE` | > 1 MB ou > 100 notas. | Dividir o lote. |
| 500 | `ERRO_INTERNO` | Falha temporária no servidor. | **Reenviar** com backoff. |
| 502/503/504 | — | Servidor indisponível / timeout. | **Reenviar** com backoff. |

Exemplo `200`:

```json
{
  "success": true,
  "codigo": "ATUALIZADO",
  "chave": "23260912345678000199550010000123451000123456",
  "status": "AGUARDANDO CADASTRO",
  "message": "Status atualizado para AGUARDANDO CADASTRO."
}
```

Exemplo `400`:

```json
{
  "success": false,
  "codigo": "INVALIDO",
  "chave": "2326",
  "status": null,
  "message": "Payload invalido.",
  "erros": ["chave obrigatoria com 44 digitos."]
}
```

Exemplo `404`:

```json
{
  "success": false,
  "codigo": "NOTA_NAO_ENCONTRADA",
  "chave": "23260912345678000199550010000123451000123456",
  "status": null,
  "message": "Nota fiscal nao encontrada no Proton-e. Reenvie depois que a nota for importada."
}
```

### 3.2 Lote

No lote a resposta HTTP é **200** sempre que o lote em si for processado (erros de autenticação, JSON e tamanho continuam 400/401/413/500).
O resultado de **cada nota** vem em `resultados[]`, na mesma ordem do envio (`indice` começa em 0), com os mesmos códigos da tabela acima.
`success` é `true` somente se todas as notas tiverem `ok: true`.

```json
{
  "success": false,
  "resumo": {
    "recebidas": 3,
    "atualizadas": 1,
    "semAlteracao": 0,
    "ignoradasDesatualizadas": 0,
    "naoEncontradas": 1,
    "invalidas": 1
  },
  "resultados": [
    { "indice": 0, "chave": "2326...3456", "ok": true,  "resultado": "ATUALIZADO", "status": "NF A CHEGAR", "message": "Status atualizado para NF A CHEGAR." },
    { "indice": 1, "chave": "2326...3457", "ok": false, "resultado": "NOTA_NAO_ENCONTRADA", "status": null, "message": "Nota fiscal nao encontrada no Proton-e. Reenvie depois que a nota for importada." },
    { "indice": 2, "chave": null, "ok": false, "resultado": "INVALIDO", "status": null, "message": "Payload invalido.", "erros": ["chave obrigatoria com 44 digitos.", "status obrigatorio (texto nao vazio)."] }
  ]
}
```

> Em lote, reenvie **somente** as notas com `resultado` = `NOTA_NAO_ENCONTRADA`. Em caso de `500`/timeout, o lote inteiro pode ser reenviado com segurança (é idempotente).

---

## 4. Regras para não quebrar nada

1. **Idempotência** — reenviar o mesmo status é seguro (`SEM_ALTERACAO`). Em qualquer dúvida (timeout, erro de rede), reenvie.
2. **Ordem** — sempre envie `atualizadoEm` com a hora real da mudança no Hexon. Assim, se duas mensagens chegarem fora de ordem, a mais antiga é descartada (`IGNORADO_DESATUALIZADO`) e o painel nunca volta para um status velho.
   - Sem `atualizadoEm`, vale a hora de chegada — entregas fora de ordem podem sobrescrever um status mais novo.
   - Para **corrigir** um status errado, envie o status correto com um `atualizadoEm` atual.
3. **Retentativa (retry)** — para `404 NOTA_NAO_ENCONTRADA`, `500`, `502`, `503`, `504` e timeout:
   - backoff sugerido: 1 min, 5 min, 15 min, 1 h, 6 h, 24 h;
   - para `404`, desistir após **7 dias** (a NF pode não pertencer a um CNPJ monitorado pelo Proton-e).
   - **Não** repetir `400`, `401` ou `413` sem corrigir a causa.
4. **Relógio** — `atualizadoEm` com mais de 5 minutos no futuro é rejeitado. Mantenha o servidor do Hexon sincronizado (NTP) e sempre informe o fuso (`-03:00` ou `Z`).
5. **Limite de taxa** — prefira lotes (até 100) a milhares de chamadas individuais; mantenha no máximo ~5 requisições simultâneas.
6. **Compatibilidade** — novos campos poderão ser adicionados às respostas; o Hexon deve ignorar campos que não conhece. Mudanças incompatíveis serão publicadas em uma nova versão (`/api/v2/...`).

---

## 5. Exemplos

### curl — nota única

```bash
curl -X POST "https://danfe.newgrup.cloud/api/v1/integracoes/hexon/status-nf" \
  -H "Authorization: Bearer dc_xxxxxxxx_SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "chave": "23260912345678000199550010000123451000123456",
    "status": "CONCLUIDO RECEBIMENTO",
    "atualizadoEm": "2026-09-14T10:30:00-03:00",
    "atualizadoPor": "joao.silva"
  }'
```

### PowerShell

```powershell
$body = @{
  chave        = "23260912345678000199550010000123451000123456"
  status       = "NF ENVIADA"
  atualizadoEm = (Get-Date).ToString("o")
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri "https://danfe.newgrup.cloud/api/v1/integracoes/hexon/status-nf" `
  -Headers @{ Authorization = "Bearer dc_xxxxxxxx_SEU_TOKEN" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

### Node.js (com retry)

```js
const URL_PROTON = 'https://danfe.newgrup.cloud/api/v1/integracoes/hexon/status-nf';
const RETENTAVEL = new Set([404, 500, 502, 503, 504]);

async function enviarStatus(nota) {
  const resp = await fetch(URL_PROTON, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PROTON_E_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(nota),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await resp.json().catch(() => ({}));
  if (resp.ok) return { entregue: true, json };
  return { entregue: false, reenviar: RETENTAVEL.has(resp.status), json };
}
```

---

## 6. O que acontece no Proton-e

Para cada nota aceita, o Proton-e grava na `NotaFiscal`:

| Campo Proton-e | Origem |
|---|---|
| `recebimentoStatus` | `status` |
| `recebimentoKanbanStatus` | `kanbanStatus` |
| `recebimentoStatusOperacional` | `statusOperacional` |
| `recebimentoStatusOperacionalCodigo` | `statusOperacionalCodigo` |
| `recebimentoAtualizadoEm` | `atualizadoEm` |
| `recebimentoAtualizadoPor` | `atualizadoPor` (padrão `Hexon`) |
| `recebimentoConsultadoEm` | hora do recebimento |
| `recebimentoErro` | limpo (`null`) |
| `etiqueta` | troca a etiqueta de status anterior pela nova |

O status aparece imediatamente no painel (badge da nota e filtro por status de recebimento) e na API de consulta
`GET /api/v1/notas/{chave}` no bloco `recebimento`.

> **Atenção:** o botão **"Consultar status"** do painel continua buscando no app de recebimento antigo e pode sobrescrever o status enviado pelo Hexon. Se o Hexon passar a ser a única fonte, evite usar esse botão.

---

## 7. Checklist de homologação

- [ ] Chave de API `Hexon` criada e guardada como segredo no Hexon.
- [ ] `POST` sem token retorna `401`.
- [ ] Nota única com chave existente retorna `200 ATUALIZADO` e o status aparece no painel.
- [ ] Reenvio idêntico retorna `200 SEM_ALTERACAO`.
- [ ] Envio com `atualizadoEm` mais antigo retorna `200 IGNORADO_DESATUALIZADO` e o painel mantém o status novo.
- [ ] Chave inexistente retorna `404 NOTA_NAO_ENCONTRADA` e entra na fila de retry do Hexon.
- [ ] Chave com 43 dígitos retorna `400 INVALIDO`.
- [ ] Lote com 101 notas retorna `413 LOTE_GRANDE`.
- [ ] Lote misto retorna `200` com o `resultado` correto por item.
