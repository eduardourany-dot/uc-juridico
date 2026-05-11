# MNI POC — Prova de Conceito (TJGO)

> Status: **prova de conceito · sandbox apenas**
> Objetivo: validar que dá pra fazer SOAP/MNI direto de Cloudflare Worker em JS sem precisar de servidor Python. Se funcionar, justifica o sprint completo MNI (Pet.MNI no roadmap).

## O que é

Worker JS que recebe `{ cnj, cpf, senha }`, monta envelope SOAP MNI 2.2.2, chama o endpoint Projudi do TJGO (`https://projudi.tjgo.jus.br/projudi/webservices/intercomunicacao`), parseia o XML retornado e devolve JSON ao frontend.

Página HTML standalone (sem dependência do app) pra invocar o Worker e ver o resultado tabulado.

## Arquivos

| Arquivo | Função |
|---|---|
| `workers/mni-tjgo-worker.js` | Worker Cloudflare. Roda em V8, free tier suficiente. |
| `tools/mni-poc.html` | Página standalone de teste (HTML+JS sem deps). |
| `docs/MNI_POC.md` | Este arquivo. |

## Setup (1 vez)

### 1 · Deploy do Worker

1. Acesse https://dash.cloudflare.com → **Workers & Pages** → **Create application** → **Create Worker**
2. Nome: `uc-mni-tjgo` → **Deploy**
3. Clique em **Edit code** → apague o template → cole **tudo** de `workers/mni-tjgo-worker.js`
4. **Save and deploy**
5. Anote a URL gerada (algo tipo `https://uc-mni-tjgo.SEU-USUARIO.workers.dev`)

### 2 · Variáveis de ambiente (CORS)

No mesmo Worker:

1. **Settings** → **Variables** → **Add variable**
2. Nome: `ALLOWED_ORIGINS`
3. Valor: `http://localhost:8000` (pra começar — só liberamos prod depois de validar)
4. **Save and deploy**

Sem essa variável, Worker assume `http://localhost:8000` por default — funciona, mas é mais limpo configurar.

### 3 · Rodar a página de teste

```bash
cd "C:\Users\marco\OneDrive\Área de Trabalho\UC_JURIDICO\uc-juridico"
python -m http.server 8000
```

Abra: **http://localhost:8000/tools/mni-poc.html**

### 4 · Testar

1. **URL da Worker**: cole a URL anotada no passo 1
2. **CPF**: seu CPF (advogado cadastrado no Projudi GO)
3. **Senha Projudi**: a mesma que você usa pra logar em `projudi.tjgo.jus.br`
4. **Número CNJ**: cole um CNJ de processo TJGO que você tenha acesso
5. **Consultar processo**

Se aparecer "✓ Sucesso!" com partes, classe, movimentos → POC validada.

## Possíveis erros

| Erro | Significado | Solução |
|---|---|---|
| `Falha de rede` no browser | CORS bloqueou | Adicione `http://localhost:8000` em `ALLOWED_ORIGINS` |
| `HTTP 401` ou `Erro de autenticação` no result | CPF/senha não bate | Tente logar em projudi.tjgo.jus.br direto |
| `HTTP 404` | Endpoint mudou | Verifique URL atual no [protótipo Python](../../mni_analysis/tribunal_registry.py) |
| `soap_fault` com mensagem específica | Erro de regra de negócio do tribunal | Mensagem geralmente é didática (ex: "processo sob segredo de justiça") |
| `http_502` ou `http_503` | TJGO offline | Espera e tenta de novo; eles caem muito |
| Worker timeout (10s default) | Resposta TJGO demorou | Plano free tem 10s/req · prod precisa upgrade |

## Critério de sucesso da POC

A POC é **bem-sucedida** se ao menos um dos cenários abaixo funcionar:

- ✅ Consultar um processo do escritório no TJGO retornar JSON com classe, partes e ≥3 movimentos
- ✅ Consultar um processo inexistente retornar erro estruturado (não crash)
- ✅ Tentar com senha errada retornar `AUTH_ERROR` (não crash)

Se sim, **o caminho B (Cloudflare Worker reescrevendo SOAP em JS) é viável**, e podemos partir pro sprint MNI completo:
- Worker genérico para múltiplos tribunais (TJGO, TRF1, STJ, TJDFT, TJSP)
- Health checker
- Cadastro de credenciais por advogado (cifrado)
- Integração com módulo Processo (substituir/complementar DataJud)
- Eventualmente: `consultarAvisosPendentes` (substituir DJEN) e `entregarManifestacaoProcessual` (peticionar do app)

## Se a POC falhar

Causas possíveis e ações:

| Diagnóstico | Próximo passo |
|---|---|
| WSDL responde mas XML parser quebra | Refinar parser regex/DOM no Worker · pode precisar de lib XML pequena |
| TJGO bloqueia IP da Cloudflare | Trocar Worker por servidor com IP fixo Brasil (caminho A) |
| Endpoint mudou | Atualizar URL · consultar `tribunal_registry.py` do protótipo |
| Auth falha consistentemente | Confirmar com Eduardo a senha · pode ter trocado |
| SOAP envelope rejeitado | Verificar namespace exato esperado pelo Projudi (pode ser diferente do padrão MNI 2.2.2) |

## Segurança

- ⚠ **Senha trafega em texto via HTTPS** (TLS protege o trânsito). Worker não persiste nada.
- ⚠ **localStorage da página armazena URL da Worker e CPF** (não a senha). Limpe se compartilhar máquina.
- ⚠ **Cloudflare Workers tem logs** — em produção, considere desativar logging de senhas.
- Pra sprint completo do MNI: planejar cifragem das credenciais persistidas no Firestore (com chave do escritório, não Google).

## Referências

- [Protótipo Python compartilhado pelo Eduardo](file:///C:/Users/marco/Documents/Orientacao%20UC%20Juridico%20-%20MNI%20Connector.zip) (zip com `mni_connector.py`, `tribunal_registry.py`, etc.)
- [Documentação MNI v2.2.2 — CNJ](https://www.cnj.jus.br/sgt/sistema-de-gestao-de-tabelas-processuais-unificadas/)
- [Resolução CNJ 234/2016](https://atos.cnj.jus.br/atos/detalhar/2335) — instituiu o MNI
- [tecjustica.substack.com — Integração PJe/MNI](https://tecjustica.substack.com/p/integracao-pjemni-nem-todo-tribunal) — bom panorama atual
