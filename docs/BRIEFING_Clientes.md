# Briefing — Sprint Cliente (v6.19+, em implementação)

> Status: **Cli.1 em implementação.** Refator pra promover Cliente de campo string em Processo → entidade dedicada com coleção, UI, migração.
> Antecipa o que era v6.21+ no roadmap original — necessário pra Honorários A.3 fazer sentido (vincular honorário a cliente, não a processo).

## Motivação

Antes (v6.18):
- `processo.client` = string → apenas display
- Honorário vinculado a `processoId` único → não modela "cliente firma contrato cobrindo vários processos"

Após Sprint Cliente:
- Coleção `clientes` no Firestore com schema próprio
- Processo ganha `clienteId` (FK)
- Honorário aponta `clienteId` + `processosCobertos: [...]` (array opcional)
- Próximos módulos (CRM, agenda, formulário de atendimento) reusam direto

## Decisões cravadas (recomendação aplicada)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Coleção | `clientes` |
| 2 | PK | `id` (uid gerado) |
| 3 | Snapshot de nome | Manter `processo.client` como string (compat). Ler do `cliente.nome` quando `clienteId` populado. |
| 4 | Multi-tenant | `escritorio_id: 'UC'` (mesmo padrão) |
| 5 | Visibilidade | Todos os 9 advogados veem todos os clientes (mesmo modelo do app) |
| 6 | Migração | Lazy: ao abrir lista de processos, varre `processos sem clienteId` e cria/vincula clientes correspondentes |
| 7 | Honorário (refator Cli.2) | `processoId` único → `clienteId` + `processosCobertos: [id1, id2]` |
| 8 | UI | Rota `/clientes` na sidebar (entre Processos e Prazos), aba "Cliente" no detalhe do processo |

## Schema Firestore

```
clientes/{id}: {
  id, escritorio_id: 'UC',
  nome,                            // obrigatório, único (case-insensitive)
  tipoPessoa: 'PF' | 'PJ',         // default 'PJ'
  cpfCnpj,                         // formato validado
  email, telefone,                 // opcionais
  endereco,                        // opcional, livre
  observacoes,
  ativo,                           // soft-flag (cliente inativo não aparece em selects de novos processos)
  criadoEm, atualizadoEm
}
```

Mudanças nos schemas existentes:

```
processos/{id}: {
  ...,
  clienteId,        // FK novo (opcional inicialmente, obrigatório após migração)
  client,           // mantém como compat — snapshot do nome
}

honorarios/{id}: {
  // ANTES (v6.18):
  // processoId,
  // clienteNome,

  // DEPOIS (v6.19):
  clienteId,                // FK obrigatório
  clienteNome,              // snapshot pra display rápido
  processosCobertos: [],    // array de processoId (0..N) — quais processos o contrato cobre
  ...resto igual
}
```

## Sub-sprints

| Sprint | Conteúdo | Conversas |
|---|---|---|
| **Cli.1** | Schema + DB layer + rota /clientes + CRUD + busca + filtros + migração lazy de processos | 1–2 |
| **Cli.2** | Refator honorários (clienteId + processosCobertos) + migração lazy + UI atualizada | 1 |
| **Cli.3** | Aba "Cliente" no processo + dashboard do cliente (`/clientes/{id}`) com processos + honorários consolidados | 1 |

**Total:** 3 sessões.

## Migração lazy de processos

Helper `_migrarClienteSeNecessario(processo)`:
1. Se `processo.clienteId` já populado → return
2. Se `processo.client` é string vazia/nula → return (sem cliente a migrar)
3. Procura cliente em cache global por `nome.toLowerCase().trim()`
4. Se encontrou → `processo.clienteId = cliente.id` + saveProcess
5. Se não encontrou → cria novo `cliente` com nome do `processo.client` + saveCliente + saveProcess
6. Idempotente

Roda em background ao abrir lista de processos. Toast informativo se migrou ≥1.

## Migração lazy de honorários (Cli.2)

Helper `_migrarHonorarioSeNecessario(honorario)`:
1. Se `honorario.clienteId` já populado → return
2. Se `honorario.processoId` populado:
   - Busca processo, pega `clienteId` (já migrado pelo Cli.1)
   - `honorario.clienteId = processoClienteId`
   - `honorario.clienteNome = processo.client` (snapshot)
   - `honorario.processosCobertos = [honorario.processoId]`
   - Remove `processoId` (legado)
   - saveHonorario
3. Idempotente

## Validações

- **Nome**: obrigatório, único (case-insensitive)
- **tipoPessoa**: 'PF' ou 'PJ', default 'PJ'
- **cpfCnpj**: opcional. Se informado, valida formato (regex; full algoritmo é exagero pra MVP)
- **email**: opcional. Se informado, regex `[^@]+@[^@]+\.[^@]+`
- **telefone**: opcional. Aceita qualquer formato.

## Firestore Security Rules

Nova entrada no padrão `isAllowed()`:

```
match /clientes/{id} {
  allow read, create, update, delete: if isAllowed();
}
```

## UI

### Sidebar (sempre visível)

Novo item entre **Processos** e **Prazos**:

```
Início · Processos · [Clientes] · Prazos · Financeiro · ...
```

### Rota `/clientes` (lista)

- Header: total de clientes + busca + botão "+ Novo cliente"
- Filtros: tipo (PF/PJ/todos) + ativo (true/false/todos)
- Tabela ou cards: nome, tipoPessoa, CPF/CNPJ, processos vinculados (count), última atualização
- Click no nome → modal de edição

### Modal "Novo / Editar cliente"

Campos:
- Nome (obrigatório, validação de duplicata)
- Tipo (PF/PJ select)
- CPF/CNPJ
- Email
- Telefone
- Endereço (livre, multi-linha)
- Observações
- Ativo (checkbox, default true)

### Aba "Cliente" no Processo (Cli.3)

Substitui o input livre `client` pelo seletor de cliente.

```
[Cliente atual: PÉROLA RJ ↗]   [trocar cliente] [editar cadastro]
```

Aba mostra:
- Dados completos do cliente (CPF/CNPJ, contato, endereço, obs)
- Outros processos vinculados (com link)
- Honorários vinculados (com totais agregados)

### Detalhe `/clientes/{id}` (Cli.3)

Dashboard do cliente:
- Header: nome + dados de contato + botão editar
- Stats: N processos · M honorários · R$ X recebido · R$ Y em aberto
- Lista de processos vinculados
- Lista de honorários consolidada
- Botões: novo processo pra esse cliente · novo honorário

## Custo Firestore

Pra ~50 clientes × cache 5min × N navegações:
- ~50 reads/abertura da lista
- 1 read/edição
- 1 write/criação
Ínfimo. Cabe sem qualquer ajuste.

---

## Próximo passo (Cli.1)

Implementação imediata:
1. Schema + DB layer + Firestore rules
2. Rota `/clientes` (lista + busca + filtros)
3. Modal de cadastro/edição
4. Migração lazy de processos
5. Smoke tests + commit v6.19.0

Cli.2 (refator honorários) e Cli.3 (aba no processo + dashboard) ficam pra próximas sessões.
