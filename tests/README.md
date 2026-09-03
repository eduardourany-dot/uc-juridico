# Testes

```bash
node tests/regressao.js
```

Sem dependências, sem instalação. Sai com código 1 se algo quebrar — dá pra
plugar direto num hook de pré-commit ou no CI.

## O que roda

**Sintaxe** — o script inline do `index.html`, os `.gs` do Apps Script e os
`.js` da raiz precisam pelo menos parsear. Um backtick solto dentro de template
literal já derrubou o app inteiro uma vez; este bloco pega isso em 1 segundo.

**Comportamento** — as funções são extraídas por nome direto do fonte e rodadas
contra dados de mentira. Cobre hoje:

| Área | O que garante |
|---|---|
| `_diasAteDia` | contagem em dia-calendário pra prazo, compromisso, parcela e follow-up; sem data devolve `NaN` (some das janelas) e não `null` (que entraria nelas) |
| `_normTexto` | acento/caixa/espaço normalizados; as cópias duplicadas não voltam |
| Log de produção | `console.log` de rotina fica atrás de `UC_debug()`; `warn`/`error` seguem diretos |
| Contagem de prazos | dia-calendário local; fatal de hoje conta 0, janela urgente inclui o 5º dia |
| `autoMarcarPerdidos` | nunca marca como perdido o prazo que vence hoje |
| Produtividade das tarefas | dia da conclusão pelo relógio local (não UTC) |
| `requireWrite_` | admin/advogado escrevem; viewer e cliente são bloqueados |
| Organizador do Drive | as 3 actions checam papel; limite de tamanho cabe no teto do Gemini |
| Backup | toda coleção nova entra em `COLECOES_BACKUP` |
| Segmentador | PDF protegido é aceito; modal de progresso fecha em caso de erro |
| Agenda | overlay de tarefas respeita o filtro de status, igual ao de prazos |

Há também guardas de regressão que varrem o fonte inteiro atrás de padrões que
já causaram bug — contagem de dias com `Math.ceil`, `PDFDocument.load` sem
`ignoreEncryption`. Elas falham se o padrão ressurgir em qualquer lugar novo.

## Por que o teste fatia string

O app é um `index.html` único de ~26 mil linhas, sem módulos. Extrair função por
nome é o único jeito de testar sem reescrever tudo. Quando o D2 do roadmap
(modularização) sair, isto vira `import` de verdade — os casos continuam valendo.

## Fuso

O arquivo força `TZ=America/Sao_Paulo` e se reexecuta, porque a contagem de
prazos é ancorada no dia-calendário local. Rodar em UTC esconderia exatamente a
classe de bug que estes testes existem pra pegar.
