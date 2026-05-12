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

## Tribunais no registry

| Código | Sistema | Status | Endpoint |
|---|---|---|---|
| `TJGO` | Projudi | ✓ **validado 11/05/2026** | `https://projudi.tjgo.jus.br/IntercomunicacaoService` |
| `TRF1` | PJe | ⚠ não validado | `https://pje1g.trf1.jus.br/pje/intercomunicacao` |
| `STJ` | PJe | ⚠ não validado | `https://ww2.stj.jus.br/processo/pje/intercomunicacao` |
| `TJDFT` | PJe | ⚠ não validado | `https://pje.tjdft.jus.br/pje/intercomunicacao` |
| `TJSP` | eSAJ | ⛔ **não suportado** (eSAJ não expõe MNI) | — |
| `TRT18` | PJe | ⚠ não validado | `https://pje.trt18.jus.br/pje/intercomunicacao` |

Tribunais marcados ⚠ têm endpoints inferidos pelo padrão PJe. **Antes de usar com credenciais**, rode o **health check** na página POC — ele faz `GET ?WSDL` e confirma se o endpoint responde XML válido.

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

- ✓ **MNI.1 (atual)** · Registry multi-tribunal · health check · Worker genérico
- ⏳ **MNI.1.2** · Cadastro cifrado de credenciais por advogado em Configurações (UI + design de cifragem cliente-side)
- ⏳ **MNI.2** · Botão "🔍 Buscar MNI" no detalhe do processo (substitui DataJud)
- ⏳ **MNI.3** · `consultarAvisosPendentes` — substitui/complementa DJEN
- ⏳ **MNI.4** · Cron de avisos (Cloudflare Cron Trigger) → notifica advogado
- ⏳ **MNI.5** · `entregarManifestacaoProcessual` — peticionar direto do app

## Segurança

- ⚠ Senha trafega via HTTPS. Worker não persiste nada além dos logs Cloudflare.
- ⚠ localStorage da página POC armazena URL da Worker, CPF e tribunal escolhido. **Não armazena senha.** Limpe se compartilhar máquina.
- ⚠ Pro sprint completo: planejar cifragem cliente-side com chave derivada de passphrase (não salva), Firestore guarda só o blob cifrado.

## Referências

- [Protótipo Python compartilhado pelo Eduardo](file:///C:/Users/marco/Documents/Orientacao%20UC%20Juridico%20-%20MNI%20Connector.zip)
- [Documentação MNI v2.2.2 — CNJ](https://www.cnj.jus.br/sgt/sistema-de-gestao-de-tabelas-processuais-unificadas/)
- [Resolução CNJ 234/2016](https://atos.cnj.jus.br/atos/detalhar/2335) — instituiu o MNI
- [tecjustica.substack.com — Integração PJe/MNI](https://tecjustica.substack.com/p/integracao-pjemni-nem-todo-tribunal)
