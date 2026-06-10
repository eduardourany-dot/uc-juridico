# #42 — Co-titularidade `ucjuridico@` em GitHub · Cloudflare · Vercel

> Continuação da tarefa **#40** (que já cobriu Firebase IAM, Apps Script, allowlist e alertas).
> Esta etapa estende o acesso da segunda titular — `ucjuridico@uranydecastro.com.br` — às
> três plataformas restantes. Todos os passos são manuais (painel web); este runbook é o roteiro.
>
> **Estado em 10/06/2026:** nenhuma das três plataformas tem `ucjuridico@` como membro.
> No GitHub, o único colaborador do repo é `eduardourany-dot` (admin) — verificado via API.

---

## 1. GitHub — colaborador no repositório

**Pré-requisito:** `ucjuridico@` precisa de uma conta GitHub própria. Se ainda não existir:
criar em https://github.com/signup usando o e-mail `ucjuridico@uranydecastro.com.br`
(sugestão de username: `ucjuridico-urany`). Ativar 2FA logo após criar.

**Convite (feito pela conta `eduardourany-dot`):**

1. Abrir https://github.com/eduardourany-dot/uc-juridico/settings/access
2. **Add people** → digitar o username (ou o e-mail) da nova conta
3. Enviar convite → `ucjuridico@` recebe e-mail e aceita

> Em repositório pessoal o colaborador recebe acesso de leitura/escrita (push/pull),
> o que é suficiente: pode clonar, commitar e subir nos branches `sandbox`/`main`.
> Papel `admin` continua só com o dono.

**Verificação:** `Settings → Collaborators` deve listar as duas contas;
a nova conta deve conseguir `git clone` + `git push` num branch de teste.

---

## 2. Cloudflare — membro da conta (workers + Pages)

Cobre os 3 workers (`uc-djen-proxy`, `uc-mni-tjgo`, `uc-datajud`) e o Cloudflare Pages (staging).
Plano free permite múltiplos membros.

1. Logar em https://dash.cloudflare.com com a conta titular
2. Menu da conta → **Manage Account → Members**
3. **Invite** → e-mail `ucjuridico@uranydecastro.com.br`
4. Role: **Administrator** (acesso total à conta, sem gestão de billing/membros — para isso
   existe o papel *Super Administrator*; Administrator basta para operar workers e Pages)
5. Enviar → aceitar o convite pelo e-mail (cria conta Cloudflare se não houver) → ativar 2FA

**Verificação:** com a conta nova, abrir Workers & Pages e confirmar que os 3 workers
e o projeto Pages aparecem e que consegue ver logs/configurações.

---

## 3. Vercel — ⚠️ limitação do plano Hobby

O projeto `uc-mni-vercel` roda no plano **Hobby (gratuito)**, que é estritamente pessoal:
**não permite adicionar membros**. Times no Vercel exigem plano **Pro** (~US$ 20/mês por assento).

Opções, em ordem de recomendação:

| Opção | Custo | Esforço | Observação |
|---|---|---|---|
| **A. Migrar a função pro Cloudflare** | R$ 0 | médio | Já temos 3 workers lá; elimina a dependência do Vercel de vez e o item 2 acima já cobre o acesso da co-titular |
| **B. Manter solo + plano de contingência** | R$ 0 | baixo | Documentar a conta (e-mail do login) e garantir que a recuperação de senha aponte pra caixa acessível por ambas as titulares |
| **C. Upgrade pra Vercel Pro** | ~US$ 40/mês (2 assentos) | baixo | Caro pro que o worker faz; só faz sentido se o Vercel for crescer no stack |

> **Decisão pendente do titular.** Se escolher a opção A, abrir tarefa própria
> (migrar `vercel-mni/` para um 4º worker Cloudflare e atualizar a URL no frontend/registry MNI).

---

## 4. Checklist de conclusão

- [ ] Conta GitHub de `ucjuridico@` criada, com 2FA
- [ ] Convite aceito no repo `uc-juridico` (aparece em Collaborators)
- [ ] Membro Cloudflare aceito, com 2FA, enxergando os 3 workers + Pages
- [ ] Decisão tomada sobre o Vercel (A, B ou C) e registrada no HANDOFF
- [ ] Atualizar a linha #42 do backlog no `HANDOFF.md` para **concluído**
