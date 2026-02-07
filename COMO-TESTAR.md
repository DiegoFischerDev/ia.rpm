# Como testar o ia-app (fluxo completo)

## Pré-requisitos

- **Node.js** (v18+)
- **MySQL** com as tabelas `ch_gestoras` e `ch_leads` (ver `ia-app/migrations/005_recreate_ch_tables.sql`)
- **.env** na pasta pai de `public_html` (Hostinger) ou em `ia-app/` (local) com:
  - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - `RESEND_API_KEY`, `MAIL_FROM`, `GESTORA_EMAIL`
- **Resend**: domínio de `MAIL_FROM` (ex.: ia.rafaapelomundo.com) verificado na Resend

---

## Fluxo completo (teste ponta a ponta)

### 1. WhatsApp → criar lead e obter link (evo)

1. Envia no WhatsApp (número ligado à Evolution) a mensagem gatilho:
   - *"Ola, gostaria de ajuda para conseguir meu credito habitação em portugal"*
2. O evo cria o lead e responde: responde com **1** (dúvidas) ou **2** (enviar documentos).
3. Responde **2**.
4. O evo coloca o lead em `aguardando_docs` e envia uma mensagem com o **link de upload**, ex.:
   - `https://ia.rafaapelomundo.com/upload/123` (substitui pelo teu domínio e o id do lead).

**Alternativa sem WhatsApp:** cria o lead à mão na BD e usa o link direto:

```sql
INSERT INTO ch_leads (whatsapp_number, nome, origem_instancia, estado, docs_enviados, created_at, updated_at)
VALUES ('351912345678', 'Teste', 'DiegoWoo', 'aguardando_docs', 0, NOW(), NOW());
-- Anota o id (ex.: 1) e usa https://ia.rafaapelomundo.com/upload/1
```

---

### 2. Primeiro acesso ao link (confirmação de email)

1. Abre o link no browser (ex.: `https://ia.rafaapelomundo.com/upload/1`).
2. Deves ver o ecrã **Nome + Email** e o botão **Avançar**.
3. Preenche nome e um **email real** (para receber o código) e clica **Avançar**.
4. Verifica o email: deve chegar um **código de 6 algarismos** (envio via Resend). O código vale 15 minutos.
5. Introduz o código e clica **Confirmar**.
6. Se estiver correto, entras no **formulário completo** (dados pessoais + documentos).

---

### 3. Formulário e documentos

1. **Dados pessoais:** nome (já preenchido), estado civil, n.º dependentes, email (readonly). Mensagem para a gestora é opcional e fica no fim.
2. **Documentos obrigatórios:** anexa um ficheiro em cada item (PDF ou imagem). Os 3 recibos têm 3 campos (Recibo 1, 2, 3). O RGPD está no fim; podes descarregar o PDF da página.
3. **Opcional – Financiamento 100%:** se marcar o checkbox, aparecem mais 3 documentos (Decl. não dívida Finanças, Seg. Social, Decl. Predial). Preenche também esses se quiseres testar o envio completo.
4. Usa os botões **Ver**, **Trocar** e **Remover** para confirmar que funcionam.
5. Clica **Enviar para a gestora**.

---

### 4. Envio e resultado

1. O botão deve passar a **"A enviar..."** e depois **"Enviado ✓"** (com animação verde), e redirecionar para a página de **confirmação**.
2. **Email:** o endereço em `GESTORA_EMAIL` deve receber o email com todos os anexos (nomes padronizados). O email do lead deve estar em CC (e Reply-To).
3. **Base de dados:** o lead deve ficar com `estado = 'docs_enviados'`, `docs_enviados = 1` e `docs_enviados_em` preenchido.

---

### 5. Testar reentrada no link (sem novo código)

1. Abre de novo o **mesmo** link de upload (ex.: `/upload/1`).
2. Deves ver apenas o campo **Email** e o botão **Continuar**.
3. Introduz o **mesmo email** que confirmaste antes e clica **Continuar**.
4. Deves entrar direto no formulário (sem pedir código outra vez). O campo email do formulário fica readonly.
5. Se usares outro email, deve dar erro (trava de segurança).

---

## Testes rápidos (só ia-app em local)

1. **Health:** `GET http://localhost:3000/api/health` → `{"ok":true}`.
2. **Upload sem lead:** `GET http://localhost:3000/upload/99999` (id inexistente) → mensagem de link inválido/não encontrado.
3. **Lead noutro estado:** altera na BD um lead para `estado = 'docs_enviados'` e abre `/upload/:id` → deve indicar que o link não está disponível (conforme lógica do servidor).

---

## Erros comuns

| Mensagem / Comportamento | Causa provável | Solução |
|--------------------------|----------------|---------|
| "Envio de email não está configurado" | Resend não configurado ou domínio não verificado | Verifica `RESEND_API_KEY`, `MAIL_FROM` e verificação do domínio na Resend. |
| Código de email não chega | Resend ou MAIL_FROM incorretos; verifica spam | Confirma Resend, domínio verificado e pasta de spam. |
| "Link não encontrado" | Id na URL não existe na tabela | Confirma o id: `SELECT id, estado FROM ch_leads;` |
| "Este link já não está disponível" | Lead não está em `aguardando_docs` | `UPDATE ch_leads SET estado = 'aguardando_docs', docs_enviados = 0, docs_enviados_em = NULL, email = NULL, email_verification_code = NULL WHERE id = X;` |
| "É necessário anexar todos os documentos..." | Faltam ficheiros obrigatórios | Anexa todos os itens da lista (e os 3 extras se tiver 100% marcado). |
| Erro de ligação à base | MySQL inacessível ou .env errado | Confirma `DB_*` no .env e que o MySQL está a correr. |

---

## Arrancar o ia-app em local

```bash
cd ia-app
npm start
```

Servidor em `http://localhost:3000`. Para testar na Hostinger, usa o domínio do ia-app (ex.: ia.rafaapelomundo.com) com o mesmo .env na pasta pai de `public_html`.

---

## Testar em produção (ia.rafaapelomundo.com)

### 1. Health check

- Abre: **https://ia.rafaapelomundo.com/api/health**
- Deves ver: `{"ok":true,"time":"..."}`

### 2. Página inicial

- Abre: **https://ia.rafaapelomundo.com/**
- Deve carregar a página inicial do ia-app.

### 3. Fluxo de upload (lead)

- Cria um lead em `aguardando_docs` na BD (ou via WhatsApp/evo) e anota o `id`.
- Abre: **https://ia.rafaapelomundo.com/upload/ID** (substitui ID pelo número).
- Segue os passos da secção «Fluxo completo» acima (nome/email → código → formulário → envio).

### 4. Dashboard (admin)

- Abre: **https://ia.rafaapelomundo.com/** (a página inicial é o dashboard).
- **Login:** usa o email e palavra-passe definidos em `ADMIN_EMAIL` e `ADMIN_PASSWORD` no .env da Hostinger.
- Após login deves ver o menu lateral (**Leads** | **Gestoras** | **Sair**).
- **Leads:** tabela com todos os leads; testa **Editar** (alterar nome, estado, gestora) e **Apagar** (com confirmação).
- **Gestoras:** testa **Nova gestora** (nome, email, WhatsApp, ativo), **Editar** e **Apagar**.
- **Sair:** termina a sessão e volta ao ecrã de login.
- O URL **/dashboard** redireciona para **/**.

### 5. Resumo rápido em produção

| O quê | URL |
|-------|-----|
| Health | https://ia.rafaapelomundo.com/api/health |
| Página inicial / Dashboard (login) | https://ia.rafaapelomundo.com/ |
| Upload (substituir ID) | https://ia.rafaapelomundo.com/upload/ID |
