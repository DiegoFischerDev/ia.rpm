# Como testar o ia-app

## 1. Pré-requisitos

- **Node.js** (v18+)
- **MySQL** com a tabela `gestora_de_credito` (mesmo schema do evo)
- **.env** na raiz do projeto ou em `ia-app/` com:
  - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
  - `RESEND_API_KEY`, `MAIL_FROM`, `GESTORA_EMAIL`

## 2. Criar um lead de teste na base de dados

A página de upload só aparece se existir um lead com `estado = 'aguardando_docs'`.

No **phpMyAdmin** (ou outro cliente MySQL), executa:

```sql
INSERT INTO gestora_de_credito (whatsapp_number, nome, origem_instancia, estado, docs_enviados, created_at, updated_at)
VALUES ('351912345678', 'Teste', 'DiegoWoo', 'aguardando_docs', 0, NOW(), NOW());
```

Anota o **id** do registo inserido (ou faz `SELECT LAST_INSERT_ID();` ou consulta a tabela). Ex.: se o id for **1**, o link de upload será `/upload/1`.

## 3. Arrancar o servidor

Na pasta do projeto (raiz ou `ia-app`), com o .env disponível:

```bash
cd ia-app
npm start
```

Deve aparecer algo como: `Servidor ouvindo na porta 3000`.

## 4. Testar no browser

1. **Health check**  
   Abre: [http://localhost:3000/api/health](http://localhost:3000/api/health)  
   Deve devolver JSON com `"ok": true`.

2. **Página de upload**  
   Abre: [http://localhost:3000/upload/1](http://localhost:3000/upload/1)  
   (Substitui `1` pelo id do lead que inseriste.)  
   - Se o lead existir e estiver em `aguardando_docs`, aparece o formulário.  
   - Se der "Link não encontrado", o id não existe na tabela.  
   - Se der "Este link já não está disponível", o lead não está em `aguardando_docs`.

3. **Preencher e enviar**  
   - Preenche os campos (estado civil, n.º dependentes, email).  
   - Anexa ficheiros em todos os campos obrigatórios (podem ser PDFs ou imagens de teste; podes usar o mesmo ficheiro em vários campos).  
   - Se não quiseres testar "Financiamento 100%", deixa o checkbox desmarcado.  
   - Clica em **Enviar documentos**.

4. **Resultado**  
   - Sucesso: redireciona para `/confirmacao/1` (ou o id usado).  
   - A gestora (email em `GESTORA_EMAIL`) e o email que colocaste no formulário devem receber o email com os anexos.  
   - Na base de dados, o lead fica com `estado = 'docs_enviados'` e `docs_enviados = 1`.

## 5. Erros comuns

- **"Envio de email não está configurado"**  
  Falta `RESEND_API_KEY` ou `MAIL_FROM` no .env, ou o domínio de `MAIL_FROM` não está verificado na Resend.

- **"Link não encontrado"**  
  O id na URL não existe em `gestora_de_credito`. Confirma o id com `SELECT id, nome, estado FROM gestora_de_credito;`.

- **"Este link já não está disponível"**  
  O lead não está em `aguardando_docs`. Para testar de novo, atualiza:  
  `UPDATE gestora_de_credito SET estado = 'aguardando_docs', docs_enviados = 0, docs_enviados_em = NULL WHERE id = 1;`  
  (ajusta o id.)

- **Erro de ligação à base**  
  Confirma `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` e que o MySQL está a correr. O .env deve estar na raiz do projeto ou em `ia-app/` (o servidor carrega de ambos).
