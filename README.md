# ia-app – ia.rafaapelomundo.com

App mínima Node.js + Express para testar deploy na Hostinger.

## Rodar localmente

```bash
npm install
npm start
```

Abre http://localhost:3000

## Deploy na Hostinger

- Repositório: https://github.com/DiegoFischerDev/ia.rpm
- Framework: Express
- Diretório raiz na Hostinger: `./ia-app` (ou apontar o deploy para esta pasta)
- Comando de início: `npm start`
- Domínio: ia.rafaapelomundo.com

## Endpoints

- `GET /` – Página inicial
- `GET /api/health` – Health check
- `POST /api/echo` – Echo do body em JSON
