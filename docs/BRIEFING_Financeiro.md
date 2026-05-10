# Briefing — Módulo Financeiro (v6.16, em implementação)

> Status: **A.1 em implementação.**
> Inspirado no template Notion "MF Advocacia & Consultoria" (Controle Financeiro), adaptado pra advocacia.
> Marketing descartado por decisão do Eduardo.

## Objetivo

Controle financeiro completo do escritório: receitas, despesas, bancos, cartões, parcelamento de honorários (vinculado a processo!), categorias com orçamento, despesas fixas recorrentes, balancete por mês/ano. Substitui planilha externa / Quicken / YNAB.

## Decisões arquiteturais (cravadas)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Modelo de dados | 6 coleções Firestore: `bancos`, `cartoes`, `categorias_fin`, `transacoes`, `recorrencias`, `honorarios` |
| 2 | Conta vs cartão em transação | Unificar em `transacoes.contaId` com `tipoConta: 'banco' \| 'cartao'` |
| 3 | Multi-tenant | `escritorioId: 'UC'` em todos (mesmo padrão do Sprint Prazos) |
| 4 | Visibilidade entre advogados | Todos os 9 advogados veem tudo (mesmo modelo do resto do app) |
| 5 | Categorias iniciais (seed) | Aluguel, Energia, Internet, Telefonia, Contabilidade, Impostos, Pró-labore, Honorários (receita), Cursos, Viagens, Software, Manutenção, Outros |
| 6 | Reconciliação bancária | Manual no MVP — advogado marca `status: 'realizado'` quando vê extrato. Open Finance / OFX import deferido |
| 7 | Anexar comprovante | Drive (mesma pasta dos PDFs) — campo `comprovanteUrl` opcional na transação |
| 8 | Honorários por êxito | 1 transação prevista única vinculada ao Processo, marcada como `realizado` quando processo terminar |
| 9 | Push de vencimento de parcela cliente | **Deferido** pra Sprint A.5 (polish). Reusa infra FCM/email do Sprint 3. |

## Schemas Firestore

```
bancos/{id}: {
  id, escritorio_id: 'UC',
  nome,                    // "Caixa Econômica", "Inter", "Nubank"
  tipo: 'corrente' | 'poupanca' | 'caixa',
  saldoAtual,              // calculado a partir das transações realizadas
  ativo,
  criadoEm, atualizadoEm
}

cartoes/{id}: {
  id, escritorio_id: 'UC',
  nome,                    // "Caixa Black", "Nubank Roxinho"
  bancoId,                 // FK opcional
  vencimentoDia,           // 1-31
  diaCorte,                // dia do fechamento (default = vencimento - 7)
  limite,
  faturaAtual,             // soma despesas do ciclo aberto
  ativo,
  criadoEm, atualizadoEm
}

categorias_fin/{id}: {
  id, escritorio_id: 'UC',
  nome,                    // "Aluguel", "Honorários"
  tipo: 'receita' | 'despesa',
  orcamentoMensal,         // null se não tem
  cor,                     // pra UI ('#a8472d' etc)
  ativo,
  criadoEm
}

transacoes/{id}: {
  id, escritorio_id: 'UC',
  tipo: 'receita' | 'despesa',
  valor,                   // sempre positivo
  data,                    // ISO date 'YYYY-MM-DD'
  categoriaId,
  contaId, tipoConta: 'banco' | 'cartao',
  processoId?, clienteNome?,           // vinculação opcional
  honorarioId?, parcelaNumero?,        // se for parcela de honorário
  recorrenteId?,                       // se gerada por recorrência
  descricao,
  comprovanteUrl?,         // Drive
  status: 'previsto' | 'realizado',
  criadoEm, atualizadoEm
}

recorrencias/{id}: {
  id, escritorio_id: 'UC',
  descricao,               // "Aluguel da sala", "Internet escritório"
  tipo: 'receita' | 'despesa',
  valor,
  categoriaId,
  contaId, tipoConta,
  diaDoMes,                // 1-31
  ativo,
  ultimaGeracao,           // ISO date
  proximaGeracao,          // calculado
  criadoEm
}

honorarios/{id}: {
  id, escritorio_id: 'UC',
  processoId, clienteNome,
  tipoHonorario: 'fixo' | 'percentual' | 'exito' | 'misto',
  valorTotal,
  parcelas: [
    { numero, valor, vencimento, transacaoId?, status: 'previsto' | 'pago' | 'atrasado' }
  ],
  observacoes,
  criadoEm, atualizadoEm
}
```

## State machine de transação

```
[criada/previsto] --confirmar pagamento--> [realizado] (terminal pra fluxo, mas editável)
                                                  ↑
                                          --gerada via recorrência--
```

Transações canceladas: deletar (sem terminal cancelado por enquanto, baixo ROI).

## UI proposta

Nova rota **`/financeiro`** na sidebar (entre **Prazos** e **Ferramentas PDF**), com sub-abas:

| Aba | Conteúdo |
|---|---|
| **Visão geral** | Saldo total consolidado · receitas/despesas do mês · top categorias · próximas faturas · próximos vencimentos de honorário |
| **Transações** | Tabela com filtros (período, conta, categoria, status), botão "+ Nova" |
| **Bancos** | Lista contas + saldo + botão "+ Novo banco" |
| **Cartões** | Lista cartões + vencimento + fatura + barra de uso do limite |
| **Honorários** | Agrupado por processo, status de cada parcela, botões pra confirmar pagamento |
| **Recorrências** | Despesas fixas + receitas previstas, geração automática mensal |
| **Balancete** | Por mês/ano: previstas vs recebidas / em aberto vs pagas, exportar CSV |

E em **cada Processo** ganha aba **"Honorários"** mostrando o que vai/já caiu daquele processo.

## Sub-sprints

| Sprint | Conteúdo | Conversas |
|---|---|---|
| **A.1** | Schema + Bancos + Transações + Visão Geral básica | 1–2 |
| **A.2** | Cartões + Categorias com orçamento + filtros avançados | 1 |
| **A.3** | Honorários parcelados + integração com Processos (aba Honorários no processo) | 1–2 |
| **A.4** | Recorrências + Balancete + exportações CSV | 1 |
| **A.5** | Push/email de vencimento de parcela cliente (reusa FCM Sprint 3) | 0.5 |

**Total: 4–6 sessões pra MVP funcional.**

## Sementes (seeds) iniciais

Categorias hardcoded no seed inicial (criadas na primeira vez que o usuário abre `/financeiro`):

**Despesas (12):**
1. Aluguel
2. Energia
3. Internet
4. Telefonia
5. Contabilidade
6. Impostos
7. Pró-labore
8. Cursos / Pós-graduação
9. Viagens
10. Software / Assinaturas
11. Manutenção
12. Outros

**Receitas (3):**
1. Honorários (vinculável a processo)
2. Honorários por êxito
3. Outros

Bancos sugeridos (advogado cadastra conforme realidade):
- Caixa Econômica
- Inter
- Nubank
- (advogado adiciona mais conforme precisar)

## Firestore Security Rules

Adicionar 6 collections novas em `firestore.rules`, mesmo padrão `isAllowed()`:

```
match /bancos/{id}        { allow read, create, update, delete: if isAllowed(); }
match /cartoes/{id}       { allow read, create, update, delete: if isAllowed(); }
match /categorias_fin/{id}{ allow read, create, update, delete: if isAllowed(); }
match /transacoes/{id}    { allow read, create, update, delete: if isAllowed(); }
match /recorrencias/{id}  { allow read, create, update, delete: if isAllowed(); }
match /honorarios/{id}    { allow read, create, update, delete: if isAllowed(); }
```

## Custo Firestore estimado

Com cache de 5 min já em vigor:
- Boot da página `/financeiro`: 1 fetch por coleção = ~6 reads
- Cada transação criada: 1 write
- Cada parcela paga: 1 update

Pra 10 advogados × 30 navegações/dia em `/financeiro` × 6 reads = 1.800 reads/dia.
Pra 200 transações criadas/mês = ~7 writes/dia.
Bem dentro do free tier Spark (50K reads / 20K writes).

---

## Próximo passo (A.1)

Implementação imediata:
1. Schema + DB layer
2. Seed inicial de categorias (lazy: cria na primeira abertura)
3. Rota `/financeiro` na sidebar
4. Sub-aba **Bancos** (CRUD)
5. Sub-aba **Transações** (CRUD + filtros básicos)
6. Sub-aba **Visão Geral** (dashboard simples)
7. Smoke tests + commit v6.16.0
