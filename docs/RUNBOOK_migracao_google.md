# Runbook — Migração da hospedagem pro ecossistema Google (Firebase Hosting)

> Decisão do titular (05/07/2026): descontinuar a LOCAWEB e concentrar tudo no Google.
> A partir de agora **não há mais upload manual** — produção passa a ser o Firebase
> Hosting do projeto `uc-juridico`, com deploy automático a cada push em `main`.

## O que já está pronto (commitado)

- `firebase.json` com a seção `hosting` (raiz do repo como public dir; backend/docs/tools
  fora do deploy; `index.html` e service workers com `no-cache` pra atualização imediata).
- Workflow `.github/workflows/firebase-hosting.yml` — deploya no push em `main`.

## Passos manuais (uma única vez)

### 1. Primeiro deploy — coloca o app no ar em minutos
```bash
cd uc-juridico
firebase login          # se ainda não estiver logado nesta máquina
firebase deploy --only hosting
```
O app sobe em **https://uc-juridico.web.app** (e `uc-juridico.firebaseapp.com`).
Teste: abrir, logar, conferir rodapé com a versão atual.

### 2. Ligar o deploy automático (GitHub Actions)
O workflow precisa de um secret com uma service account. O jeito fácil:
```bash
firebase init hosting:github
# responder: repositório eduardourany-dot/uc-juridico · branch main · sem build
```
Isso cria a service account no projeto e grava o secret no GitHub sozinho.
(Se ele criar um workflow próprio, pode apagar o dele e manter o nosso, só conferindo
que o nome do secret bate: `FIREBASE_SERVICE_ACCOUNT_UC_JURIDICO`.)

Alternativa manual: Console GCP → IAM → Service Accounts → criar conta com papel
**Firebase Hosting Admin** → gerar chave JSON → GitHub → Settings → Secrets →
Actions → `FIREBASE_SERVICE_ACCOUNT_UC_JURIDICO`.

### 3. Apontar o domínio `uc.uranydecastro.adv.br`
Firebase Console → Hosting → **Add custom domain** → `uc.uranydecastro.adv.br` →
ele fornece os registros (TXT de verificação + A/CNAME) pra criar no DNS.
SSL é emitido automaticamente após a verificação (pode levar até ~24h).

### ⚠️ 4. ANTES de cancelar a LOCAWEB — conferir onde está a ZONA DNS
Se o DNS de `uranydecastro.adv.br` é gerenciado **na LOCAWEB**, cancelar o serviço
derrubaria o domínio inteiro — **inclusive os e-mails do Workspace (registros MX)**.
Nesse caso, migrar a zona primeiro:
1. Criar a zona no **Cloudflare** (conta já existe, usada pelos workers) ou no registro.br.
2. Copiar TODOS os registros atuais — em especial os **MX do Google Workspace** e
   TXT (SPF/DKIM/DMARC) — antes de qualquer mudança.
3. Adicionar os registros do Firebase Hosting (passo 3).
4. Trocar os nameservers no registro.br pro novo DNS.
5. Só depois de propagado e testado (site + e-mail): cancelar a LOCAWEB.

Se o DNS já estiver no registro.br/Cloudflare, é só o passo 3 e a LOCAWEB pode ser
cancelada quando quiser.

## Estado durante a transição

- A LOCAWEB fica **congelada na v6.89.0** até o domínio migrar — funcional, mas sem updates.
- O **GitHub Pages** (espelho legado) continua auto-atualizando a cada push em `main` e
  serve de acesso à versão mais nova enquanto o domínio não vira.
- Concluída a migração, avaliar desativar o GitHub Pages (host único = D3 do roadmap).

## Staging (opcional, depois)
`firebase deploy -P staging --only hosting` publica no projeto `uc-juridico-staging`
(substituindo o Cloudflare Pages, se quiser consolidar tudo no Google).
