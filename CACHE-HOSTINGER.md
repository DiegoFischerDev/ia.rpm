# Cache e deploy na Hostinger – ver alterações e logs após o deploy

Se **nem os logs nem as alterações de código** aparecem após o build/deploy, o problema mais provável é o **processo Node.js não ter sido reiniciado**. O servidor continua a correr a versão antiga em memória.

## 0. Reiniciar a aplicação Node.js (obrigatório após cada deploy)

Na Hostinger, **fazer build ou enviar ficheiros novos não reinicia sozinho o processo Node**. Tens de reiniciar manualmente:

1. **hPanel** → **Websites** → escolhe o site (ia-app ou evo)
2. Entra na secção da **aplicação Node.js** (por vezes em "Avançado" ou "Node.js")
3. Clica em **"Restart"** (ou "Reiniciar") na aplicação

Faz isto **em ambos** (ia-app e evo) após cada deploy. Sem restart, o código novo e os logs (ex.: envio para WhatsApp) **não entram em efeito**.

### Como confirmar que reiniciou

Chama o health check e verifica o campo **startedAt** (hora em que o processo arrancou):

- **ia-app:** `https://ia.rafaapelomundo.com/api/health` → deve devolver `startedAt` com a hora recente
- **evo:** URL do teu evo + `/api/health` → `startedAt` com hora recente

Se o `startedAt` for de há horas ou dias, o processo não foi reiniciado após o último deploy.

---

## 1. Confirmar que o problema é cache (HTML/estáticos)

No **hPanel** da Hostinger:

- **Websites** → **Dashboard** do teu site → **Overview**
- Ativa **"No cache preview"** (ou equivalente) e abre o site nessa janela.

Se aí vires a versão nova e noutra janela normal ainda a antiga, o problema é cache.

## 2. Limpar cache na Hostinger

### Cache Manager (servidor)

- **hPanel** → **Websites** → **Dashboard** do site
- Pesquisa por **"Cache Manager"**
- Clica em **"Purge All"** para limpar o cache do site (LiteSpeed / servidor).

Faz isto **depois de cada deploy** em que queiras que as alterações apareçam de imediato.

### CDN (se estiver ativo)

- **hPanel** → **CDN**
- Se o CDN estiver ativo, usa **"Flush cache"** (ou equivalente) para limpar o cache da CDN.

### TTL

O **TTL** (tempo de vida do cache) define por quanto tempo a resposta fica em cache. Na Hostinger isso costuma ser configurado no Cache Manager ou nas opções do plano. Após **Purge All**, o cache fica vazio; o próximo pedido vai ao Node e a resposta pode voltar a ser cacheada pelo TTL definido no painel. Se não encontras opção para reduzir o TTL só para o teu domínio/app, o que resolve na prática é **Purge All** após cada deploy.

## 3. Cache no browser

- **Hard refresh:** Ctrl+Shift+R (Windows/Linux) ou Cmd+Shift+R (Mac)
- Ou abrir o site em **janela anónima/privada** para testar sem cache local

## 4. O que a aplicação já faz

O **ia-app** envia estes cabeçalhos nas rotas que servem HTML (`/` e `/upload/:leadId`):

- `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0`
- `Pragma: no-cache`
- `Expires: 0`

Assim, o browser e muitos proxies/CDN são instruídos a não guardar resposta. Se mesmo assim a Hostinger (LiteSpeed ou camada à frente do Node) estiver a cachear, pode ignorar estes cabeçalhos consoante a configuração do servidor. Nesse caso, **Purge All** no Cache Manager após cada deploy é a solução prática.

## Resumo

1. Testar com **"No cache preview"** no hPanel para confirmar que é cache.
2. Após cada deploy: **Cache Manager** → **Purge All** (e **Flush** na CDN se usares).
3. No browser: hard refresh ou janela anónima para ver a versão nova.
