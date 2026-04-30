# UC Jurídico v4.0 · Instalação e atualização

## ⚠️ Migração desde v3.x

A versão 4.0 traz **mudança arquitetural completa**: agora há banco de dados local (IndexedDB) com persistência entre sessões. Os dados de carteira (processos, prazos, notas) são novos — **não havia equivalente na v3**, então não há migração necessária. O que existir em PDFs processados antigamente continua disponível através das ferramentas.

## Atualizando o GitHub Pages

Os arquivos a substituir no repositório `eduardourany-dot/pdf-juridico` são:

```
index.html        ← novo (3.077 linhas, 161 KB)
manifest.json     ← atualizado (nome, atalhos novos)
service-worker.js ← v4.0 cache (força atualização nos clientes)
```

Os arquivos abaixo permanecem iguais:
```
logo.png · logo-white.png · icon-192.png · icon-512.png · icon-maskable-512.png · favicon-32.png
```

### Passos

1. **Backup recomendado:** abra o app atual (v3.x) no Chrome/Edge desktop. Como na v3.x não havia banco de dados, não há nada para exportar — apenas garanta que a primeira coisa que fará na v4 é criar processos.

2. **Subir os arquivos:** vá em https://github.com/eduardourany-dot/pdf-juridico, clique em cada arquivo (index.html, manifest.json, service-worker.js), use "Edit this file" ou "Upload files" e suba a versão nova.

3. **Forçar atualização:** após o GitHub Actions republicar (1-2 min), abra o app, **feche todas as abas**, e reabra https://eduardourany-dot.github.io/pdf-juridico/ — o service worker v4.0 detecta a versão antiga e atualiza automaticamente.

4. **Em dispositivos onde já está instalado como PWA:** abra o app, ele atualiza sozinho ao detectar nova versão.

## O que há de novo na v4

### 🎯 Banco de dados local (IndexedDB)
Pela primeira vez o app **lembra** dos seus dados entre sessões: processos, eventos, prazos, jurisprudência, notas, prompts personalizados. Tudo armazenado **apenas no seu dispositivo**, sem nuvem.

### 📊 Dashboard
Tela inicial com visão consolidada da carteira:
- Total de processos · prazos ativos · prazos urgentes · vencidos
- Próximos 5 prazos com cores (vermelho ≤3d, âmbar ≤7d, verde >7d)
- 5 processos mais recentes
- Banner discreto de backup recomendado a cada 7 dias

### 🗂 Gestão de processos
Cada processo é uma "ficha digital" com 6 abas:
1. **Visão geral** — identificação CNJ, cliente, área, tribunal, próximo prazo destacado
2. **Eventos** — timeline com todos os eventos detectados, vinculados a notas
3. **Prazos** — pendentes e concluídos, com cálculo automático
4. **Jurisprudência** — citações catalogadas por tipo (REsp, Tema, Súmula...)
5. **Notas** — anotações livres, podem ser vinculadas a eventos específicos
6. **Análise IA** — gerar pacote pronto para Claude

### ⏰ Painel de prazos
Agenda consolidada da carteira inteira, agrupada por urgência. Exporta como CSV. Marca como concluído com um clique.

### 🛠 Ferramentas PDF (todas as 12)
Mesmas funções da v3, agora com **vínculo opcional ao processo**: ao indexar autos com um processo selecionado, os eventos detectados são salvos automaticamente nele. Idem para jurisprudência.

### ⚡ Diligência rápida (mobile)
Modo otimizado para audiência/fórum:
- Calcular prazo (data + dias úteis)
- Foto + OCR (com câmera do celular)
- Nota rápida em processo
- Buscar jurisprudência salva
- Achar processo

### 🤖 Pacote para Claude
Botão **"Copiar para área de transferência"** que monta:
- Identificação do processo
- Cronologia de eventos
- Prazos ativos
- Jurisprudência catalogada
- Notas
- Prompt sênior pré-preenchido com sua área e nº CNJ

Cole direto no chat do Claude — sem download intermediário.

### 📜 Geração de ficha processual
Botão **"Gerar ficha"** produz documento HTML formatado (EB Garamond, smallCaps, padrão Urany de Castro) com toda informação do processo, pronto para imprimir como PDF e entregar ao cliente.

### 💾 Backup e sincronização
Em **Configurações → Backup**:
- Exportar todos os dados como `.uc-backup.json`
- Importar de outro dispositivo

Sincronização desktop ↔ celular: exporte no desktop, envie o arquivo (Drive, e-mail, WhatsApp), importe no celular. Sem servidor central.

### 🌙 Modo escuro
Em **Configurações → Aparência**. Identidade visual mantida (preto, dourado, creme).

### 🔒 Segurança
- Apagar todos os dados (com confirmação dupla)
- Auditoria visível de "nenhum upload nesta sessão"
- Senha mestra (em desenvolvimento para v4.1)

## Estrutura de dados (técnico)

Todos os dados ficam no IndexedDB do navegador, banco `uc-juridico`, com 9 stores:
- `processes` · processos cadastrados
- `events` · eventos PJe/eSAJ vinculados a processos
- `deadlines` · prazos calculados ou manuais
- `notes` · anotações livres
- `jurisprudence` · citações catalogadas
- `pdfs` · PDFs originais (Blob)
- `prompts` · templates personalizados de análise
- `settings` · preferências (tema, lembretes)
- `history` · log de operações recentes

## Suporte

Bugs ou sugestões: clique no botão "thumbs down" abaixo de qualquer resposta do Claude que tenha gerado este código.

---

**Eduardo Urany de Castro · OAB/GO 16.539 · OAB/DF 87.243**
