# API de integração — ia-app (leads externos)

Este documento descreve como **outra aplicação** pode criar leads no backend deste projeto (`ia-app`), por exemplo a partir de um CRM ou formulário próprio.

## Base URL

Use o domínio onde o `server.js` está exposto em produção (ex.: `https://ia.rafaapelomundo.com`). As rotas abaixo são relativas a essa origem.

## Autenticação

A integração usa um segredo partilhado definido no servidor:

- Variável de ambiente: **`IA_APP_INTEGRATION_SECRET`** (string forte, gerada aleatoriamente).

O cliente deve enviar esse valor em **um** destes formatos:

| Método | Cabeçalho |
|--------|-----------|
| Preferido | `X-Integration-Secret: <o mesmo valor que IA_APP_INTEGRATION_SECRET>` |
| Alternativo | `Authorization: Bearer <o mesmo valor que IA_APP_INTEGRATION_SECRET>` |

Se `IA_APP_INTEGRATION_SECRET` não estiver definido no servidor, a rota responde **503** (`Integração não configurada no servidor.`).

Segredo incorreto: **403** (`Credenciais inválidas.`).

### Variável opcional: URL pública do site

- **`IA_APP_PUBLIC_BASE_URL`**: base usada para montar o link de upload na resposta (ex.: `https://ia.rafaapelomundo.com`). Se não estiver definida, usa-se `https://ia.rafaapelomundo.com`.

---

## Criar lead — `POST /api/integration/leads`

O cliente envia **apenas** o WhatsApp e o **nome** do lead.

1. **Número já registado:** se já existir um lead com esse **WhatsApp** (mesmos dígitos normalizados), **não** se cria um novo registo. Resposta **200** com `existing: true`, `id` e `upload_url` da conta **já existente** (o nome enviado é ignorado para não duplicar contas).
2. **Número novo:** gera-se um **id** único com **7 dígitos**, grava-se o lead (`origem_instancia = api_integracao`, `estado_conversa = aguardando_escolha`, `estado_docs = aguardando_docs`, sem gestora até confirmar email em `/upload`). Resposta **201** com `existing: false`.

**Pedidos em paralelo:** na base de dados deve existir o índice **UNIQUE** em `whatsapp_number` (migration `038_ch_leads_whatsapp_unique.sql`). Assim, dois pedidos ao mesmo tempo com o mesmo número só conseguem gravar **uma** linha; o segundo recebe erro de duplicado e o backend devolve o mesmo lead (`existing: true`) em vez de criar outro registo.

Em ambos os casos o cliente recebe **`id`**, **`upload_url`** e **`lead`**.

### Corpo (JSON)

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `whatsapp_number` ou `whatsapp` | **Sim** | Número de WhatsApp; o servidor normaliza para **apenas dígitos**. |
| `nome` | **Sim** | Nome do lead (texto não vazio). |
| `comentario` | Não | Texto gravado no campo `comentario` do lead (visível no dashboard). Só é aplicado quando é criado um **novo** registo; se a resposta for `existing: true` (WhatsApp já existia), o comentário deste pedido **não** altera o registo existente. |

### Resposta **201** (conta criada agora)

```json
{
  "ok": true,
  "existing": false,
  "id": 7234567,
  "upload_url": "https://ia.rafaapelomundo.com/upload/7234567",
  "lead": { ... }
}
```

### Resposta **200** (WhatsApp já tinha conta)

```json
{
  "ok": true,
  "existing": true,
  "id": 7234567,
  "upload_url": "https://ia.rafaapelomundo.com/upload/7234567",
  "lead": { ... }
}
```

- **`existing`**: `false` = novo lead; `true` = reutilização do lead já existente para esse número.
- **`upload_url`**: link para enviar ao utilizador final.

### Outras respostas

| HTTP | Significado |
|------|-------------|
| **400** | Falta WhatsApp ou nome. |
| **403** | Segredo inválido. |
| **503** | Servidor sem `IA_APP_INTEGRATION_SECRET`, falha rara ao gerar id único, ou erro interno equivalente. |
| **500** | Erro interno. |

### Exemplo cURL

```bash
curl -sS -X POST "https://ia.rafaapelomundo.com/api/integration/leads" \
  -H "Content-Type: application/json" \
  -H "X-Integration-Secret: SEGREDO" \
  -d '{
    "whatsapp": "+351 912 345 678",
    "nome": "Maria Silva",
    "comentario": "Resultado 100%"
  }'
```

---

## Atualizar comentário — `PATCH /api/integration/leads/comment`

Atualiza o campo `comentario` de um lead **já existente**, identificado pelo WhatsApp.

- **Autenticação**: igual (mesmo `IA_APP_INTEGRATION_SECRET`)
- **Comportamento**: **substitui** o comentário inteiro pelo novo valor (mantém apenas o último).

### Corpo (JSON)

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `whatsapp_number` ou `whatsapp` | **Sim** | Número do lead (normalizado para dígitos). |
| `comentario` | **Sim** | Texto a gravar. |

### Respostas

| HTTP | Significado |
|------|-------------|
| **200** | Atualizado. Corpo: `{ "ok": true, "lead": { ... } }` |
| **400** | Falta WhatsApp ou comentário. |
| **403** | Segredo inválido. |
| **404** | Não existe lead para esse WhatsApp. |
| **500** | Erro interno. |

### Exemplo cURL

```bash
curl -sS -X PATCH "https://ia.rafaapelomundo.com/api/integration/leads/comment" \
  -H "Content-Type: application/json" \
  -H "X-Integration-Secret: SEGREDO" \
  -d '{ "whatsapp": "351912345678", "comentario": "Comentário atualizado (substitui o anterior)." }'
```

---

## Solicitar atendimento — `POST /api/integration/leads/request-atendimento`

Usado quando a outra aplicação quer pedir que uma gestora atenda um lead já existente.

Comportamento:

1. Procura o lead por `whatsapp`/`whatsapp_number`.
2. Se o lead ainda não tiver gestora (`gestora_id` vazio), atribui uma gestora disponível (regra `getNextGestoraForLead`).
3. Marca o lead como:
   - `atendimento_status = "aguardando_atendimento"`
   - `atendimento_solicitado_em = NOW()`
   - `atendimento_realizado_em = NULL`
4. Devolve os dados do lead e da gestora atribuída.

### Corpo (JSON)

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `whatsapp_number` ou `whatsapp` | **Sim** | Número do lead (normalizado para dígitos). |

### Respostas

| HTTP | Significado |
|------|-------------|
| **200** | Pedido registado. Corpo: `{ "ok": true, "lead": { ... }, "gestora": { ... } }` |
| **400** | Falta WhatsApp. |
| **403** | Segredo inválido. |
| **404** | Lead não encontrado para esse WhatsApp. |
| **503** | Sem gestora disponível para atribuir (quando o lead não tinha gestora). |
| **500** | Erro interno. |

### Exemplo cURL

```bash
curl -sS -X POST "https://ia.rafaapelomundo.com/api/integration/leads/request-atendimento" \
  -H "Content-Type: application/json" \
  -H "X-Integration-Secret: SEGREDO" \
  -d '{ "whatsapp": "351912345678" }'
```

---

## Resumo para copiar para outro projeto Cursor

1. Definir `IA_APP_INTEGRATION_SECRET` no servidor e reiniciar Node.
2. Opcional: `IA_APP_PUBLIC_BASE_URL` se o domínio público for diferente do default.
3. `POST /api/integration/leads` com JSON `{ "whatsapp" ou "whatsapp_number", "nome" [, "comentario"] }` e cabeçalho de segredo.
4. Opcional: `PATCH /api/integration/leads/comment` para substituir comentário de lead existente.
5. Novo: `POST /api/integration/leads/request-atendimento` para colocar lead na fila da gestora (`aguardando_atendimento`).
6. Usar `upload_url` (ou `https://ia.rafaapelomundo.com/upload/` + `id`) para o utilizador; tratar `existing === true` como “já existia conta para esse WhatsApp” (mesmo link).

Não exponha o segredo em repositórios públicos nem em frontend; use variáveis de ambiente no serviço que chama a API.

---

## Erro «Integração não configurada no servidor» (503)

Significa que, **no processo Node que serve o site**, `IA_APP_INTEGRATION_SECRET` está **vazio ou ausente**. Não é um problema do utilizador final nem da outra app em si — o servidor ainda não “vê” a variável.

### Como ter a certeza

1. **Endpoint de estado** (após deploy do código recente): abre no browser ou faz `curl`:
   ```bash
   curl -sS "https://ia.rafaapelomundo.com/api/integration/status"
   ```
   - `{"integration_secret_configured":true}` → o segredo está definido neste servidor.
   - `{"integration_secret_configured":false}` → a variável **não** está carregada; continua a haver 503 no `POST`.

2. **Ficheiro `startup.log`** na pasta do `ia-app` no servidor: após reiniciar Node, deve aparecer `.env encontrado em: ...` se existir ficheiro; se `IA_APP_INTEGRATION_SECRET` estiver vazio, aparece a linha de AVISO.

3. **Causas frequentes (ex.: Hostinger)**  
   - `.env` não foi enviado para o servidor ou está na **pasta errada**. O Node tenta: pasta **pai** da app (`../.env`) e pasta **`ia-app`** (`./.env`).  
   - Variável definida só no painel mas **nome errado** (espaço, typo) ou não associada à **aplicação Node** que corre em produção.  
   - **Reinício** em falta após alterar `.env` ou variáveis.  
   - A outra app a apontar para **outro URL** (staging/local) onde o segredo não existe.

4. **Teste manual do POST** (substitui `SEGREDO` pelo valor real do servidor):
   ```bash
   curl -sS -o /dev/stderr -w "%{http_code}" -X POST "https://ia.rafaapelomundo.com/api/integration/leads" \
     -H "Content-Type: application/json" \
     -H "X-Integration-Secret: SEGREDO" \
     -d '{"whatsapp":"351900000000","nome":"Teste"}'
   ```
   - `503` + mensagem de integração → segredo vazio **no servidor**.  
   - `403` → segredo definido mas **valor diferente** do enviado no header.  
   - `200` ou `201` → OK.
