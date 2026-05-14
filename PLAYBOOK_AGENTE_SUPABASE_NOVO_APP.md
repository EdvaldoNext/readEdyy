# Playbook do agente: Supabase em app novo sem tocar no que já existe

Use este ficheiro em **qualquer repositório** onde uma aplicação nova precise de Supabase. O agente deve **ler isto primeiro** antes de criar tabelas, Storage ou políticas.

## Autenticação Supabase: não inventar (regra do agente)

**Por defeito, o agente não deve criar, configurar nem assumir fluxos de autenticação** — a menos que o **humano peça explicitamente** login, sessão ou identidade de utilizador.

Em concreto, **não fazer** sem pedido claro do utilizador:

- Ativar ou documentar como obrigatório **Anonymous sign-ins**, **Google / OAuth**, **e-mail / magic link** ou outros **Providers** em Authentication → Providers.
- Introduzir no código **`signInAnonymously()`**, **`getSession()`**, **`getUser()`**, **`onAuthStateChange`**, **`signInWithOAuth`**, persistência de sessão Auth, nem redirecionamentos de callback de Auth.
- Escrever migrações ou RLS que **exijam** `auth.uid()` / utilizador autenticado **se o requisito do projeto for “abrir sem login”** (uso só da chave `anon` no cliente).

**Quando o humano não pedir autenticação:** tratar o app como **acesso só com chave `anon` / publishable** no browser: políticas RLS para o role **`anon`**, Storage e tabelas expostas de acordo com esse modelo, e **deixar explícito no README** o trade-off de segurança (quem tiver a anon key pode aceder ao que essas políticas permitem).

**Só depois de o humano pedir** login, contas ou “cada utilizador vê só os seus dados”: aí sim desenhar Auth (sessão, providers, `auth.uid()` nas políticas, etc.) e alinhar com o dashboard Supabase.

Esta regra evita que o agente “siga o tutorial padrão” do Supabase e imponha Auth onde o produto deve ser **sem sessão Auth** (como no ReadEra: sem Anonymous, sem Providers, sem sessão Auth).

## Regra absoluta (não negociável)

1. **Não alterar** aplicações, tabelas, funções, triggers, buckets ou políticas que já existam no projeto Supabase e pertençam a **outros produtos** (ex.: QuickSync, PlanilhasB, etc.).
2. **Não fazer** `ALTER TABLE`, `DROP`, `TRUNCATE`, `DELETE` em massa, renomeações ou migrações que atinjam objetos que **não** foram criados explicitamente para a **nova** aplicação.
3. Para a nova aplicação: criar **só o que for novo** — tabelas, índices, funções, buckets Storage e políticas RLS **com nomes ou prefixos claramente deste app**.

Se o projeto Supabase for **partilhado** por várias apps, tratar o Postgres como **multi-inquilino por convenção de nomes**, não como base “livre” para editar tudo.

## Como nomear para nunca colidir

- **Tabelas e views:** prefixo do app, por exemplo `minhaapp_` ou `readera_` (ex.: `readera_documents`, `readera_user_preferences`).
- **Funções / triggers:** mesmo prefixo ou schema dedicado, por exemplo `minhaapp_touch_updated_at`.
- **Storage:** bucket **dedicado** com nome único (ex.: `minhaapp_pdfs`), nunca reutilizar bucket de outro produto.
- **Opcional (isolamento mais forte):** schema próprio `minhaapp` com `CREATE SCHEMA minhaapp` e tabelas lá dentro; expor no API conforme config do Supabase.

Evitar nomes genéricos sozinhos (`documents`, `users`, `settings`) em bases partilhadas.

## Fluxo recomendado para o agente

1. **Identificar** o `project-ref` correto (lista de projetos, doc do repo, ou pergunta ao humano). **Nunca adivinhar** o ref.
2. **Inventariar** o que já existe antes de mudar qualquer coisa:

   ```bash
   npx supabase db query --linked "select tablename from pg_tables where schemaname='public' order by 1;"
   ```

3. **Escrever** a migração em ficheiro `.sql` no repositório (ex.: `supabase/migrations/YYYYMMDDHHMMSS_minhaapp_init.sql`) contendo **apenas** `CREATE` / `CREATE OR REPLACE` dos **seus** objetos e políticas **apenas** sobre esses objetos.
4. **Aplicar** com ficheiro (SQL longo nunca só “colado” sem revisão):

   ```bash
   npx supabase db query --linked -f supabase/migrations/SEU_FICHEIRO.sql
   ```

5. **Revalidar** que só apareceram objetos novos com o vosso prefixo e que tabelas antigas não foram tocadas (mesma query de inventário + `pg_policies` se necessário).

## Integração no frontend

- Usar **chave `anon` / publishable** apenas no cliente. **Nunca** `service_role` no browser.
- **RLS** obrigatório em tabelas expostas; as políticas devem corresponder ao modelo acordado:
  - **Sem pedido de login:** políticas para o role **`anon`** (ou o modelo que o humano definiu sem Auth).
  - **Com pedido de login:** políticas com **`auth.uid()`** (ou equivalente) e fluxo de Auth alinhado com o que foi pedido.
- **Não** assumir nem documentar **Authentication → Providers** (Anonymous, Google, etc.) **só porque é comum nos exemplos do Supabase** — só se o humano pedir autenticação.

## Quando não der para projeto Supabase dedicado

Limite de projetos free, orçamento, etc., pode forçar **várias apps no mesmo projeto**. Aí:

- reforça-se o prefixo / schema dedicado;
- **proíbe-se** editar tabelas alheias;
- documenta-se no repositório qual ref está ligado e quais tabelas são “território” de cada app.

## O que versionar vs. o que não versionar

- **Versionar:** `supabase/config.toml`, migrações `.sql`, este playbook (ou link para ele).
- **Não versionar:** senhas de base de dados, `service_role`, ficheiros `.env` com segredos.

## Resumo de uma linha para copiar no prompt noutro projeto

```text
Leia PLAYBOOK_AGENTE_SUPABASE_NOVO_APP.md: Supabase só com objetos NOVOS (prefixo/schema do app), sem ALTER/DROP em tabelas ou buckets de outras aplicações; validar project-ref, inventariar o remoto, migrar por ficheiro SQL, revalidar. Não criar Auth (Anonymous, Providers, sessão) sem pedido explícito do utilizador.
```

---

*Este playbook é genérico. O ficheiro `SUPABASE_INDEPENDENCIA.md` neste repo continua a ser a “memória operacional” específica do ReadEra quando estiveres nesse projeto.*
