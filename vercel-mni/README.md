# UC Jurídico — Worker MNI no Vercel (gru1 / São Paulo)

Variante do `workers/mni-worker.js` rodando em **Vercel Edge Functions** na região `gru1` (São Paulo, Brasil) em vez de Cloudflare Workers (US/EU).

## Por quê?

TRT18 e outros tribunais da **Justiça do Trabalho (PJe)** bloqueiam o IP do Cloudflare Workers via "administrative rules" do servidor (HTTP 403 em 41ms — bloqueio em nível de rede, antes de qualquer header ou autenticação).

Hipótese: IP brasileiro (datacenter AWS São Paulo, onde o Vercel `gru1` roda) pode passar.

## Setup

### 1. Instalar Vercel CLI (uma vez)

```powershell
npm install -g vercel
vercel login
```

Faz login com sua conta Google ou GitHub.

### 2. Deploy preview (sandbox)

```powershell
cd vercel-mni
vercel deploy
```

Na primeira vez, Vercel pergunta:
- "Set up and deploy?" → **Y**
- "Which scope?" → escolhe sua conta
- "Link to existing project?" → **N**
- "Project name?" → `uc-mni-vercel` (ou outro)
- "Code directory" → `.` (atual)

Resultado: URL preview tipo `https://uc-mni-vercel-xyz123.vercel.app`

### 3. Testar

```powershell
curl https://uc-mni-vercel-xyz123.vercel.app/api/mni?info
```

Deve retornar JSON com `versao` do worker (mesmo formato do Cloudflare Worker).

### 4. Apontar sandbox pra esse worker

No app sandbox (`uc-juridico-sandbox.pages.dev`), abre Console:

```javascript
// Atualiza só o staging worker URL (não toca em prod)
const { getFirestore, doc, setDoc } = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
const db = getFirestore();
const cur = (await (await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')).getDoc(doc(db, 'settings', 'mniConfig'))).data();
await setDoc(doc(db, 'settings', 'mniConfig'), {
  ...cur,
  workerUrl: 'https://uc-mni-vercel-xyz123.vercel.app/api/mni'
}, { merge: true });
console.log('Worker URL atualizada no sandbox');
```

Mais simples: vai em **Configurações → MNI** no app sandbox e cola o novo URL no campo "Worker MNI".

### 5. Testar TRT18 e re-validar TJGO

- Abre processo TRT18 → 🔍 Atualizar via MNI
- Se passar (não mais HTTP 403): 🎉 funcionou
- Também testa TJGO pra garantir que continua funcionando

### 6. Deploy production (se sandbox validar)

```powershell
cd vercel-mni
vercel --prod
```

Vai pra URL fixa `https://uc-mni-vercel.vercel.app/api/mni` (ou nome escolhido).

Depois aponta o `mniConfig.workerUrl` no Firestore **prod** (`uc-juridico`).

## Custo

Vercel Free tier:
- 100 GB-hora compute / mês
- 1M Edge Function invocations / mês

Pra escritório com ~2000 processos × 1 sync/semana = ~8000 invocations/mês. Muito abaixo do free tier.

## Quando funcionar

Se TRT18 passar via Vercel, vamos atualizar o registry pra marcar os tribunais Trabalhistas como `validado: true` quando vier via Vercel worker (ainda bloqueado via Cloudflare).

Pode rodar `workerUrl` diferentes por categoria de tribunal no futuro (auto-routing).

## Quando NÃO funcionar

Se Vercel `gru1` IPs também forem bloqueados pelo TRT18, próximas opções:
- **Cloud Run** GCP `southamerica-east1` (~$0-5/mês)
- **VPS brasileiro** (Hostinger BR / DigitalOcean SP, ~$5/mês)
- **Proxy residencial brasileiro** (Bright Data, $50+/mês — mais garantido)

## Estrutura

```
vercel-mni/
├── api/
│   └── mni.js          ← Adaptador Vercel Edge Function
├── vercel.json         ← Config (region: gru1)
├── package.json
└── README.md
```

O código real do worker fica em `../workers/mni-worker.js` (compartilhado com Cloudflare). Vercel bundla automaticamente ao deploy.
