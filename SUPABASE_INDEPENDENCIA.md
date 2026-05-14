# Supabase - Operacao Rapida e Independencia do Agente

Playbook operacional para o agente trabalhar com independencia no Supabase com velocidade, seguranca e sem quebrar outros projetos.

**Playbook genérico (qualquer repo / app nova):** ver `PLAYBOOK_AGENTE_SUPABASE_NOVO_APP.md` — regra de não alterar apps existentes e criar só objetos novos com prefixo ou schema dedicado.

## Objetivo

Garantir que o agente consiga, em qualquer repo:

- conectar no projeto Supabase correto;
- executar SQL remoto sem tentativa e erro desnecessaria;
- corrigir Auth/RLS rapidamente;
- evitar efeitos colaterais entre apps (ex.: QuickSync x PlanilhaSB);
- documentar tudo de forma reproduzivel.

## Resumo do que aprendemos neste projeto

- O app `planilhasb` estava inicialmente apontando para projeto antigo.
- Foi migrado para `epijxziihqnhwghiuuej`.
- Tabela `public.despesas` criada/ajustada.
- RLS primeiro foi aberta (CRUD publico) e depois corrigida para modelo por usuario com `user_id`.
- Google Auth foi integrado no frontend.
- Dados antigos "sumiram" por RLS porque estavam sem `user_id`; recuperacao foi feita vinculando ao usuario correto.
- Redirecionamento cruzado para QuickSync ocorreu por `site_url` do Auth apontando para outro app.

## Regras de ouro para nao quebrar outro projeto

1. **Cada app deve ter projeto Supabase proprio** (ideal).
2. Se compartilhar projeto (nao ideal), nunca confiar apenas em `site_url`; sempre usar `redirectTo` no frontend.
3. Sempre validar `project-ref` antes de executar qualquer SQL/config.
4. Toda mudanca em Auth URL impacta o projeto inteiro, nao apenas um frontend.

## Pré-requisitos tecnicos

1. Node e npm instalados.
2. Supabase CLI operacional via `npx supabase`.
3. Sessao autenticada no CLI.
4. Projeto linkado com `supabase link`.
5. Senha do banco Postgres (nao e senha de login da conta).

## Diferenca de credenciais (critico)

- `Access Token` da conta: autentica CLI/management.
- `sb_publishable_...`: chave publica do frontend.
- `sb_secret_...`/`service_role`: servidor apenas, nunca no browser.
- Database password: usada no `supabase link`.

## Checklist de bootstrap (2 minutos)

```bash
node -v
npm -v
npx supabase --version
npx supabase projects list
npx supabase link --project-ref <PROJECT_REF>
npx supabase db query --linked "select now();"
```

Se passou nisso, o agente esta operacional.

## Fluxo padrao de execucao (sempre)

1. Identificar projeto correto (`project-ref`, URL e chave publishable).
2. Fazer leitura de diagnostico (colunas, policies, contagens).
3. Aplicar mudanca com SQL em arquivo (`-f`), nao inline longo.
4. Revalidar com query objetiva.
5. Comunicar impacto e proximo passo para teste do usuario.

## Padrao de Auth Google (frontend)

- `signInWithOAuth({ provider: "google", options: { redirectTo } })`
- `redirectTo` deve ser:
  - ``${window.location.origin}${window.location.pathname}``
- Limpar parametros OAuth da URL depois do retorno (`code`, `state`, etc).
- Exibir app somente com sessao valida.

## Padrao de Auth Google (Supabase)

No projeto correto:

- Provider Google habilitado com `Client ID` e `Client Secret`.
- `site_url` do app correto.
- `additional_redirect_urls` com URLs do app (root e index).
- No Google Cloud, redirect URI:
  - `https://<PROJECT_REF>.supabase.co/auth/v1/callback`

## RLS recomendado para app pessoal por usuario

Tabela `public.despesas`:

- coluna `user_id uuid references auth.users(id)`.
- políticas para `authenticated`:
  - select own (`user_id = auth.uid()`)
  - insert own (`with check user_id = auth.uid()`)
  - update own (`using + with check`)
  - delete own (`using`)

## Recuperacao de dados antigos apos ativar RLS

Sintoma: dados "sumiram" apos login.

Causa: linhas sem `user_id`.

Passos:

1. Listar usuarios em `auth.users`.
2. Contar linhas sem `user_id`.
3. Atualizar linhas antigas para o `user_id` correto.
4. Validar distribuicao por `user_id`.

## Comandos de diagnostico que economizam tempo

```bash
npx supabase db query --linked "select column_name from information_schema.columns where table_schema='public' and table_name='despesas';"
npx supabase db query --linked "select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='despesas';"
npx supabase db query --linked "select to_char(date_trunc('month', data),'YYYY-MM') as mes, count(*) from public.despesas group by 1 order by 1;"
```

## Troubleshooting rapido

### `supabase: command not found`

Use `npx supabase ...`.

### `Cannot find project ref`

Rode `npx supabase link --project-ref <PROJECT_REF>`.

### `accepts at most 1 arg(s)` em SQL

SQL longo deve ser executado com `-f arquivo.sql`.

### Login Google cai no app errado

- `site_url` do projeto esta apontando para outro app.
- Corrigir `site_url` e `additional_redirect_urls`.
- Garantir `redirectTo` explicito no frontend.

### Erro de RLS ao inserir

- conferir se existe policy de `insert`.
- conferir se payload manda `user_id = auth.uid()` quando a policy exige.

## Boas praticas de versionamento

- Versionar:
  - `supabase/config.toml`
  - scripts SQL de schema/policy
  - docs de operacao
- Nao versionar:
  - `supabase/.temp`
  - segredos locais

## Limite de memoria do agente

Nao existe memoria global permanente garantida entre projetos.  
Este arquivo e a memoria operacional oficial: ao abrir outro projeto, comecar por ele para acelerar execucao.

## Prompt mestre (copiar e colar em novos projetos)

Use este prompt quando abrir o agente em outro repo e quiser execucao rapida com independencia no Supabase:

```text
Modo execucao rapida Supabase.

1) Antes de qualquer coisa, LEIA este arquivo:
`SUPABASE_INDEPENDENCIA.md`

2) Trabalhe com autonomia total, seguindo o playbook do documento:
- validar ambiente (node, npm, npx supabase)
- validar autenticacao da CLI
- identificar project-ref correto
- linkar projeto
- validar query remota
- executar ajustes necessarios no banco e no frontend
- revalidar tudo com evidencias

3) Regras obrigatorias:
- nao adivinhar project-ref, sempre confirmar
- para SQL longo, usar arquivo `.sql` + `npx supabase db query --linked -f ...`
- aplicar RLS por usuario (`user_id = auth.uid()`) quando o app for autenticado
- evitar efeito colateral entre projetos (Auth URL/redirect compartilhados)
- sempre reportar o que foi mudado e o que falta validar

4) Objetivo:
deixar o projeto pronto para producao com autenticacao, seguranca e fluxo funcional sem quebrar apps paralelos.

Comece agora lendo `SUPABASE_INDEPENDENCIA.md` e execute.
```

## ReadEra (este repositório) — estado operacional

**Objetivo:** o agente consegue executar SQL remoto com a CLI já linkada, sem MCP.

| Item | Valor |
|------|--------|
| **Project ref** | `ezcmdbcxgqvonqewgvrm` |
| **Nome no dashboard** | `quicksync-independente` |
| **URL API** | `https://ezcmdbcxgqvonqewgvrm.supabase.co` |
| **Chave no frontend** | `anon` (JWT) em `config.js` — **nunca** `service_role` no browser |

### Por que este projeto (e não um “ReadEra” novo)?

A conta atingiu o **limite de 2 projetos free**. `npx supabase projects create readera-independente` falhou com *maximum limits for the number of active free projects*. Foi feito `supabase link` neste ref para não reutilizar `epijxziihqnhwghiuuej` (PlanilhasB / `edevaldoprieto`), evitando misturar Auth e dados daquele app.

No banco já existia só `public.quick_sync_data`. A migração `supabase/migrations/20250513120000_readera_init.sql` foi aplicada com sucesso; hoje existem também `documents`, `user_preferences` e o bucket Storage **`pdfs`**.

**Garantia QuickSync / outras apps:** esse SQL **não** altera, apaga nem insere em `quick_sync_data` (nem em qualquer outra tabela pré-existente). Só usa `CREATE TABLE IF NOT EXISTS`, políticas e Storage no bucket `pdfs`. **Nada precisa ser desfeito** em relação ao QuickSync.

**Regra daqui em diante (ReadEra neste mesmo projeto Supabase):** qualquer tabela nova deste app deve ser criada **somente** com prefixo `readera_` (ex.: `readera_bookmarks`), ou em um schema dedicado `readera`, para nunca colidir com nomes genéricos de outros apps. As tabelas atuais `documents` e `user_preferences` já estão criadas com nomes genéricos; se quiser renomeá-las para `readera_documents` / `readera_user_preferences`, isso exige migração + ajuste no `index.html` — posso fazer noutro passo se pedir.

### Comandos de verificação (copiar e colar)

```bash
cd C:\Users\Note\Documents\HTML\ReadEra
npx supabase projects list
npx supabase db query --linked "select tablename from pg_tables where schemaname='public' order by 1;"
```

SQL longo (reaplicar ou ajustar schema):

```bash
npx supabase db query --linked -f supabase/migrations/20250513120000_readera_init.sql
```

### Rede instável / “login role” / timeout

Se aparecer *failed to initialise login role* ou *SUPABASE_DB_PASSWORD*:

1. Dashboard → **Settings → Database** → copiar a **Database password** (não é a senha da conta Supabase).
2. PowerShell (sessão atual ou `.env.local` carregado pelo seu fluxo):

```powershell
$env:SUPABASE_DB_PASSWORD = "SUA_SENHA_DO_POSTGRES"
npx supabase db query --linked "select 1;"
```

### Auth do app ReadEra (sem login)

O ReadEra **não** usa Supabase Auth (sem Anonymous, sem Google, sem e-mail). Só a **chave `anon`** no `config.js` + políticas RLS para o role **`anon`** em `documents` e no bucket Storage **`pdfs`**.

Migração aplicável: `supabase/migrations/20250514153000_readera_anon_no_login.sql` (caminhos de ficheiro: `readera/{uuid}.pdf`).

**Aviso de segurança:** com este modelo, quem tiver a `anon key` e a URL da API pode listar/alterar os PDFs deste bucket neste projeto. Use só em contexto pessoal ou com outro projeto Supabase dedicado.

Preferências de tema/TTS ficam **só em `localStorage`** neste modo (a tabela `user_preferences` continua sem acesso para `anon`).

### Segurança

- A saída de `npx supabase projects api-keys` contém **service_role**: não commitar, não colar no frontend; se vazou em canal inseguro, **gire a chave** no dashboard.
- Versionar: `supabase/config.toml`, `supabase/migrations/*.sql`, este doc. Não versionar: `.env.local`, senhas de DB.

## Prompt curto (ultra rapido)

```text
Leia `SUPABASE_INDEPENDENCIA.md` primeiro e execute o playbook completo de independencia Supabase neste projeto (setup, link, auth, RLS, validacoes e correcoes), com autonomia total e sem quebrar outros apps.
```

