# Configurar Resend (domínio) e MySQL na Hostinger

## 1. Verificar o domínio na Resend (para MAIL_FROM)

Para enviar emails com `noreply@ia.rafaapelomundo.com`, o domínio **ia.rafaapelomundo.com** tem de estar verificado na Resend.

### Passos

1. **Entrar na Resend**  
   - Aceder a [resend.com](https://resend.com) e fazer login.

2. **Adicionar o domínio**  
   - No menu lateral: **Domains** → **Add Domain**.  
   - Inserir: `ia.rafaapelomundo.com` (sem `www`, sem `https://`).  
   - Confirmar.

3. **Ver os registos DNS**  
   - A Resend mostra uma lista de registos que tens de criar no teu fornecedor de domínio (ex.: Hostinger, Cloudflare).  
   - Tipicamente são:
     - **SPF (TXT)** – ex.: `v=spf1 include:_spf.resend.com ~all`
     - **DKIM (CNAME)** – ex.: nome `resend._domainkey` → valor indicado pela Resend
     - Por vezes um **TXT** de verificação (ex.: `_resend` com um token)

4. **Criar os registos no sítio do domínio**  
   - Onde geres o DNS do domínio (Hostinger: **Domínios** → escolher o domínio → **DNS / Zona DNS**; ou Cloudflare, etc.):  
     - Adicionar cada **TXT** e **CNAME** exatamente como a Resend indica (nome/host e valor).  
   - Guardar e esperar alguns minutos (a propagação pode demorar até 24–48 h, muitas vezes menos).

5. **Verificar na Resend**  
   - Na Resend, no domínio que adicionaste, carregar em **Verify** / **Verify Domain**.  
   - Quando estiver **Verified**, podes usar qualquer endereço desse domínio em **MAIL_FROM** (ex.: `noreply@ia.rafaapelomundo.com`).

6. **Se algo falhar**  
   - A Resend tem uma ferramenta de diagnóstico (ex.: [dns.email](https://dns.email)) e documentação por fornecedor (Hostinger, etc.).  
   - Verificar se não há erros de escrita nos nomes e valores dos registos (especialmente no CNAME do DKIM).

---

## 2. MySQL na Hostinger (DB_HOST e resto do .env)

O **DB_HOST** deve ser o **servidor MySQL** que a Hostinger atribui à tua base de dados. Não uses `127.0.0.1` à toa se o painel indicar outro valor.

### Onde ver na Hostinger

1. **Entrar no painel**  
   - [hpanel.hostinger.com](https://hpanel.hostinger.com) (ou o painel da tua conta).

2. **Bases de dados**  
   - Menu: **Bases de dados** / **Databases** (ou **MySQL Databases**).  
   - Abrir a base que usas para o projeto (ex.: `u150959679_evo_leads`).

3. **Dados de ligação**  
   - Aí vês:
     - **Servidor / Host** → é o valor para **DB_HOST** (por vezes `localhost`, ou algo como `mysql123.hostinger.pt` ou o nome do servidor que a Hostinger mostrar).
     - **Utilizador** → **DB_USER**
     - **Palavra-passe** → **DB_PASSWORD**
     - **Nome da base** → **DB_NAME**
   - A porta costuma ser **3306** → **DB_PORT=3306**.

4. **Atualizar o .env**  
   - Na pasta pai de `public_html` em **ia.rafaapelomundo.com**, no ficheiro **.env**, coloca exatamente o que o painel mostrar, por exemplo:

```env
DB_HOST=localhost
# ou o host que a Hostinger indicar, ex.:
# DB_HOST=mysql123.hostinger.pt
DB_PORT=3306
DB_USER=u150959679_evo_user
DB_PASSWORD=...
DB_NAME=u150959679_evo_leads
```

- Se a Hostinger mostrar um host diferente de `127.0.0.1`, altera **DB_HOST** para esse valor e guarda o .env.

Depois de:
- o domínio estar **Verified** na Resend, e  
- o **.env** na Hostinger ter **DB_HOST** (e resto) iguais ao painel,

o envio de emails e a ligação à base devem funcionar.
