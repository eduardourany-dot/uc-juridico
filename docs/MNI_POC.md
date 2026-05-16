# MNI POC — Prova de Conceito + sprint MNI.1

> Status: **POC TJGO validada (11/05/2026) · sprint MNI.1 em andamento**
> Objetivo: rodar SOAP/MNI direto de Cloudflare Worker em JS pra não precisar de servidor Python.
> POC TJGO validada — agora generalizando pra multi-tribunal (TRF1, STJ, TJDFT, TRT18 · TJSP fora porque é eSAJ).

## Histórico

| Versão | Data | O que mudou |
|---|---|---|
| 0.1 (POC) | 11/05/2026 | `mni-tjgo-worker.js` validado end-to-end no TJGO (Projudi). Descobertas: endpoint `/IntercomunicacaoService`, namespace `servico-intercomunicacao-2.2.2/` (com prefixo `servico-` e trailing slash), SOAPAction vazio (`""`), schema usa atributos em `<pessoa nome=...>` e `<movimentoLocal descricao=...>`. |
| 0.2 (MNI.1) | 11/05/2026 | `mni-worker.js` genérico + registry de 6 tribunais (`mni-tribunais.json`) + operações `health` (probe `?WSDL`) e `listarTribunais`. UI POC ganhou dropdown de tribunal e botão de health check. |

## Arquivos

| Arquivo | Função |
|---|---|
| `workers/mni-worker.js` | **Worker genérico v0.2** — recebe `tribunal` no body, roteia via registry. Use este. |
| `workers/mni-tribunais.json` | Registry canônico (humanos + frontend). Espelhado dentro do Worker como `TRIBUNAIS_REGISTRY`. |
| `workers/mni-tjgo-worker.js` | POC v0.1 (só TJGO). **Mantido pra referência** — vai ser removido depois do sprint estabilizar. |
| `tools/mni-poc.html` | Página standalone de teste com dropdown de tribunal + health check + consulta. |
| `docs/MNI_POC.md` | Este arquivo. |

## Tribunais no registry (v0.4.0 · 63 tribunais)

Registry expandido a partir de `tribunal_registry.py` (UC Jurídico v4.3.0, Eduardo) + 21 TRTs adicionados (TRT1-24 completo) + correções de path via health check 11/05/2026.

### ✓ Validados via health check (10)

| Código | Tempo | Sistema | Endpoint |
|---|---|---|---|
| TJGO | 99ms | Projudi | `projudi.tjgo.jus.br/IntercomunicacaoService` |
| TRF1 | 206ms | PJe | `pje1g.trf1.jus.br/pje/intercomunicacao` |
| TRF5 | 271ms | PJe | `pje.trf5.jus.br/pje/intercomunicacao` |
| TJMT | 436ms | PJe | `pje.tjmt.jus.br/pje/intercomunicacao` |
| TJMS | 147ms | eSAJ | `esaj.tjms.jus.br/mniws/.../intercomunicacao` |
| **TJSP** | **45ms** | eSAJ | `http://esaj.tjsp.jus.br/mniws/.../intercomunicacao` ⚠ HTTP |
| TJES | 87ms | PJe | `pje.tjes.jus.br/pje/intercomunicacao` |
| TJMA | 429ms | PJe | `pje.tjma.jus.br/pje/ConsultaPJe` ⚠ rota especial |
| TJCE | 356ms | PJe | `pje.tjce.jus.br/pje1grau/intercomunicacao` |
| TJAC | 1055ms | eSAJ | `esaj.tjac.jus.br/mniws/.../intercomunicacao` |

### ⛔ Não suportados

| Código | Motivo |
|---|---|
| TJAP | Tucujuris (sistema próprio, sem MNI) |
| TRF1_eProc | Hostname eproc1g.trf1.jus.br não existe (eProc no TRF1 está nas seções judiciárias, hosts próprios) |

### Status dos demais (categorias)

- **Bloqueio Cloudflare (12)**: TST, TRF2, TRF3, TRF4, TRF6, TJDF, TJRJ, TJSC, TJBA, TJAL, TJTO — HTTP 530/520/403 indica que origin existe mas firewall bloqueia o IP do Cloudflare. Provável funcionar via browser real do user. Testar com credenciais.
- **Cert SSL inválido (2)**: STF, TJPE — HTTP 526. Configuração do tribunal precisa ser corrigida.
- **Timeout (2)**: STJ, TJPA — origin não respondeu em 8s.
- **Path errado (9)**: TJMG, TJPR, TJPR_PJe, TJRS, TJRN, TJSE, TJAM, TJRR, TJRO — endpoint cadastrado responde HTTP 200/404 mas não WSDL. Provavelmente migrou path (como o TJGO fez de `/projudi/webservices/` pra `/IntercomunicacaoService`).
- **Não testado (28)**: TJPA_PJe + TRT1, TRT3-TRT9, TRT11-TRT17, TRT19-TRT24 (21 TRTs adicionados após descoberta do path real).

### Correções importantes (v0.4)

- **TJPI**: path corrigido de `/pje/intercomunicacao` → `/1g/intercomunicacao` (WSDL válido confirmado via WebFetch). MNI 2.2.3.
- **TRT18, TRT2, TRT10 + 21 novos TRTs**: path real é `/primeirograu/servicosweb/mni222/intercomunicacao` (descoberto via TRT15 que documenta publicamente). Antes o registry usava `/pje/intercomunicacao` que dava 404.
- **TJPA_PJe**: adicionado como sistema paralelo (Eduardo sinalizou).
- **TRT1-24 completo**: registry agora cobre TODOS os Tribunais Regionais do Trabalho do Brasil.

### Detecção automática por CNJ

Operação `detectarPorCnj` no Worker: dado um número CNJ, devolve o tribunal pelo segmento (J=4 federal, 5 trabalho, 8 estadual) + código TT (Resolução CNJ 65/2008). Útil pro MNI.2 (botão "🔍 Buscar MNI") detectar tribunal automaticamente.

Exemplo:
```
POST { operacao: "detectarPorCnj", cnj: "0234509-41.2014.8.09.0006" }
→ { sucesso: true, codigo: "TJGO", tribunal: {...} }

POST { operacao: "detectarPorCnj", cnj: "0000123-45.2024.4.01.3400" }
→ { sucesso: true, multiplos: true, candidatos: ["TRF1", "TRF1_eProc"] }

POST { operacao: "detectarPorCnj", cnj: "0000123-45.2024.5.18.0011" }
→ { sucesso: true, codigo: "TRT18", tribunal: {...} }
```

## Setup (1 vez)

### 1 · Deploy do Worker genérico

1. `dash.cloudflare.com` → **Workers & Pages** → **Create application** → **Create Worker**
2. Nome: `uc-mni` → **Deploy**
3. **Edit code** → apaga template → cola **tudo** de `workers/mni-worker.js`
4. **Save and deploy**
5. Anota a URL (ex.: `https://uc-mni.SEU-USUARIO.workers.dev`)

> Se ainda tiver o `uc-mni-tjgo` deployado do POC, pode deletar — o novo cobre o caso TJGO.

### 2 · Variável de ambiente (CORS)

No mesmo Worker:
1. **Settings** → **Variables** → **Add variable**
2. Nome: `ALLOWED_ORIGINS`
3. Valor: `http://localhost:8000` (POC) ou `http://localhost:8000,https://eduardourany-dot.github.io` (prod)
4. **Save and deploy**

### 3 · Rodar a página de teste

```bash
cd "C:\Users\marco\OneDrive\Área de Trabalho\UC_JURIDICO\uc-juridico"
python -m http.server 8000
```

Abre: **http://localhost:8000/tools/mni-poc.html**

### 4 · Fluxo de teste

1. **URL da Worker**: cole a URL anotada
2. **↻ Carregar lista de tribunais**: opcional — sincroniza dropdown com o registry do Worker
3. **Selecione tribunal** (TJGO já vem por padrão)
4. **🩺 Health check**: dispara probe sem credenciais — confirma se o endpoint responde WSDL
5. **CPF + senha + CNJ** → **Consultar processo**

## Operações do Worker

```
POST /
Content-Type: application/json

# Listar tribunais (sem credenciais)
{ "operacao": "listarTribunais" }

# Health check (sem credenciais)
{ "operacao": "health", "tribunal": "TRF1" }

# Consultar processo (precisa credenciais)
{ "operacao": "consultarProcesso", "tribunal": "TJGO",
  "cnj": "...", "cpf": "...", "senha": "...", "debug": false }
```

`GET /` retorna mini-status: versão, tribunais suportados, operações.

## Possíveis erros

| Erro | Significado | Solução |
|---|---|---|
| `Falha de rede` no browser | CORS bloqueou | Adicione `http://localhost:8000` em `ALLOWED_ORIGINS` |
| `tribunal_desconhecido` | Código fora do registry | Use um dos 6 listados acima |
| `tribunal_nao_suportado` | TJSP (eSAJ) | Não tem MNI público — vai precisar caminho alternativo |
| Health retorna `resposta_inesperada` | URL responde mas não é WSDL | Endpoint do registry tá errado pra esse tribunal — atualizar |
| Health retorna `falha_rede` | Tribunal offline ou bloqueando Cloudflare | Tenta de novo · se persistir, considerar IP fixo Brasil |
| `HTTP 401` ou `Erro de autenticação` | CPF/senha errados | Confirma no portal direto do tribunal |
| `soap_fault` | Regra de negócio do tribunal | Mensagem geralmente é didática (ex: "processo sob segredo") |
| `http_502`/`http_503` | Tribunal caiu | Espera (especialmente TJGO cai bastante) |
| Worker timeout (10s default) | Resposta demorou | Plano free: 10s/req. Prod: upgrade pra Paid (~30s) |

## Critério de sucesso da POC ✓

A POC TJGO foi **bem-sucedida** em 11/05/2026:
- ✓ Consulta retornou JSON com 8 partes (com advogados), 303 movimentos, dados básicos completos
- ✓ Parser extraiu: cnj, classe, assunto, órgão julgador, valor causa, magistrado, fase, status
- ✓ XML cru de ~140KB processado em ~1.8s (Worker)

**Caminho B (Cloudflare Worker reescrevendo SOAP em JS) validado.**

## Próximas etapas (sprint MNI)

- ✓ **MNI.1** · Registry multi-tribunal · health check · Worker genérico
- ✓ **MNI.1.2** · Cadastro cifrado de credenciais por advogado em Configurações
- ✓ **MNI.2** · Botão "🔍 Buscar MNI" no detalhe do processo (substitui DataJud)
- ✗ **MNI.3** · `consultarAvisosPendentes` — descartado (DJEN cobre intimações com parser de prazo mais maduro; MNI.3 removido em v0.8.0 do worker)
- ✓ **MNI.4 fase 1** · DJEN auto-check ao abrir o app + banner dourado (commit 68241d6)
- ✓ **MNI.4 fase 2** · Cron Apps Script diário (08h, dias úteis) → varre DJEN com app fechado → pre-fetch em `djen/{hash}` (status=`pending`) → push FCM. Setup em `backend/DjenCron.gs`.
- ⏳ **MNI.5** · `entregarManifestacaoProcessual` — peticionar direto do app

## Setup MNI.4 fase 2 (Apps Script cron DJEN)

Arquivo: `backend/DjenCron.gs`

1. Cola o arquivo no Apps Script Editor (script.google.com do projeto UC Jurídico)
2. Confirma que `FCM_SERVICE_ACCOUNT_JSON` está em **Script Properties** (já está, configurado pra cron de Lembretes)
3. Testa sem efeitos colaterais:
   - Execute → `_previewDjenCron` → "Ver registros" mostra quantas pubs seriam encontradas, sem gravar nem mandar push
4. Testa com efeitos (cuidado: vai mandar push real):
   - Execute → `_testarDjenCron`
5. Cria trigger:
   - Acionadores (⏰) → **+ Adicionar acionador**
   - Função: `cron_djenAutoCheck`
   - Tipo de fonte: **Time-driven**
   - Tipo: **Day timer**
   - Hora: **8h - 9h**
   - Notificações: **Notificar imediatamente** (manda email se falhar)

### Schema novo no Firestore

Collection `djen/{hash}` ganha campos do cron:
- `source: 'djen-cron'`
- `status: 'pending'` (cron) → `imported` ou `orphan` (após user triar) → `dismissed` (opcional)
- `matched: boolean` — classificação do cron (CNJ casa com processo cadastrado)
- `fetchedAt: timestamp` — quando o cron capturou
- `oab: { numero, uf, nome }` — qual OAB trouxe

Doc `settings/djenCron`:
- `value.enabled: boolean` (default true)
- `value.lastRun: timestamp`
- `value.lastDataFim: 'YYYY-MM-DD'`
- `value.lastNovas: number`
- `value.lastOrfas: number`

### Comportamento no app

`djenMaybeAutoCheck()` (chamado ~10s após boot) agora:
1. Lê `djen/` filtrado por `status='pending' AND source='djen-cron'`
2. Se houver pendings: adapta pro shape da API, mostra banner dourado, **skipa API direta**
3. Se vazio: fallback pra fetch direto (comportamento da fase 1)

Quando user clica "Importar" no modal, `DB.saveDjenPublication` salva com status `imported`/`orphan` (overwrite do cron `pending`). Próxima boot, banner não aparece mais pra essa pub.

## Segurança

- ⚠ Senha trafega via HTTPS. Worker não persiste nada além dos logs Cloudflare.
- ⚠ localStorage da página POC armazena URL da Worker, CPF e tribunal escolhido. **Não armazena senha.** Limpe se compartilhar máquina.
- ⚠ Pro sprint completo: planejar cifragem cliente-side com chave derivada de passphrase (não salva), Firestore guarda só o blob cifrado.

## Referências

- [Protótipo Python compartilhado pelo Eduardo](file:///C:/Users/marco/Documents/Orientacao%20UC%20Juridico%20-%20MNI%20Connector.zip)
- [Documentação MNI v2.2.2 — CNJ](https://www.cnj.jus.br/sgt/sistema-de-gestao-de-tabelas-processuais-unificadas/)
- [Resolução CNJ 234/2016](https://atos.cnj.jus.br/atos/detalhar/2335) — instituiu o MNI
- [tecjustica.substack.com — Integração PJe/MNI](https://tecjustica.substack.com/p/integracao-pjemni-nem-todo-tribunal)
