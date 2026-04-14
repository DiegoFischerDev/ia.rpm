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

O cliente envia **apenas** o WhatsApp e o **nome** do lead. O servidor:

1. Gera um **id numérico único com 7 dígitos** (entre 1.000.000 e 9.999.999).
2. Grava o lead com `origem_instancia = api_integracao`, `estado_conversa = aguardando_escolha`, `estado_docs = aguardando_docs`, **sem gestora** (atribuição ao confirmar email em `/upload`).
3. Devolve o **`id`**, o **`upload_url`** completo e o objeto **`lead`**.

### Corpo (JSON)

| Campo | Obrigatório | Descrição |
|-------|-------------|-----------|
| `whatsapp_number` ou `whatsapp` | **Sim** | Número de WhatsApp; o servidor normaliza para **apenas dígitos**. |
| `nome` | **Sim** | Nome do lead (texto não vazio). |

Não envie `id`: o servidor **ignora** ids vindos do cliente e gera sempre um id novo.

### Resposta **201** (sucesso)

```json
{
  "ok": true,
  "id": 7234567,
  "upload_url": "https://ia.rafaapelomundo.com/upload/7234567",
  "lead": { ... }
}
```

- **`id`**: repetido por conveniência (é o mesmo que `lead.id`).
- **`upload_url`**: link para enviar ao utilizador final (documentos / fluxo de email na página de upload).

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
    "nome": "Maria Silva"
  }'
```

---

## Resumo para copiar para outro projeto Cursor

1. Definir `IA_APP_INTEGRATION_SECRET` no servidor e reiniciar Node.
2. Opcional: `IA_APP_PUBLIC_BASE_URL` se o domínio público for diferente do default.
3. `POST /api/integration/leads` com JSON `{ "whatsapp" ou "whatsapp_number", "nome" }` e cabeçalho de segredo.
4. Usar `upload_url` (ou `https://ia.rafaapelomundo.com/upload/` + `id`) para o utilizador.

Não exponha o segredo em repositórios públicos nem em frontend; use variáveis de ambiente no serviço que chama a API.
