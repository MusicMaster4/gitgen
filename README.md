# Git Command Generator

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=nextdotjs" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Bun-ready-fbf0df?style=flat-square&logo=bun&logoColor=black" alt="Bun" />
  <img src="https://img.shields.io/badge/license-non--commercial-cf7a6b?style=flat-square&labelColor=101014" alt="Non-commercial license" />
</p>

<p align="center">
  <b>Escreve, o comando aparece. Sem frescura.</b><br />
  Gera fluxos Git prontos pra copiar — e mensagens de commit com IA a partir do diff real do repositório.
</p>

---

## O que é

Ferramenta local (Next.js) para montar e copiar comandos Git do dia a dia:

- linkar repo e fazer o primeiro push
- criar branch, merge, stash, push e commit
- checkout e restore (tudo ou um arquivo)
- **gerar mensagem de commit com IA** (OpenRouter ou OpenAI) lendo o `git status` / diff da pasta que você indicar

Ideal pra quem quer ir rápido sem decorar cada variação de comando — e ainda sair com Conventional Commits decentes.

## Features

| Área | O que faz |
|------|-----------|
| **Fluxos prontos** | Scripts multi-linha com `git add`, `commit`, `push`, `checkout`, `merge`, etc. |
| **IA de commit** | Lê o working tree local e devolve uma mensagem curta no formato Conventional Commits |
| **Provedores** | OpenRouter **ou** OpenAI (chave no servidor ou na UI) |
| **Idioma** | Mensagens em `en` ou `pt` |
| **Persistência local** | Preferências no `localStorage` do browser |
| **Cópia em 1 clique** | Cada card copia o bloco de comandos pro clipboard |

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4**
- API route Node (`/api/commit-message`) que executa `git` localmente e chama o provedor de IA
- Runtime recomendado: **Bun** (também funciona com Node)

## Início rápido

### 1. Clone e instale

```bash
git clone https://github.com/MusicMaster4/git-command-generator.git
cd git-command-generator
bun install
```

> Se preferir: `npm install` / `pnpm install` também servem.

### 2. Configure o ambiente

```bash
cp .env.example .env.local
```

Edite `.env.local` (esse arquivo **nunca** deve ir pro git):

```env
# openrouter | openai
AI_PROVIDER=openrouter

OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemini-2.0-flash-001

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini

COMMIT_LANGUAGE=en
```

Você pode deixar as chaves vazias no `.env.local` e preencher só na interface — ou o contrário: chave só no servidor e UI sem digitar nada.

### 3. Rode

```bash
bun run dev
```

Abra [http://localhost:2001](http://localhost:2001).

### Scripts úteis

| Comando | Descrição |
|---------|-----------|
| `bun run dev` | Dev server na porta **2001** |
| `bun run build` | Build de produção |
| `bun run start` | Serve o build (porta 2001) |
| `bun run lint` | ESLint |
| `bun run typecheck` | TypeScript sem emitir arquivos |

## Como usar a geração de commit

1. Em **Config**, informe o **caminho absoluto** da pasta do projeto git (ex.: `H:\Python\meu-app`).
2. Escolha o provedor (OpenRouter / OpenAI) e o modelo.
3. Garanta uma chave: no `.env.local` **ou** no campo da tela.
4. Faça suas edições no repo de verdade.
5. Em um card (push, commit, branch…), deixe a mensagem vazia e clique em copiar — a API gera a mensagem a partir do diff e monta o bloco de comandos.

Sem chave / sem pasta válida, os cards ainda copiam comandos com mensagens padrão.

## Segurança (importante)

| Arquivo / dado | Vai pro git? |
|----------------|--------------|
| `.env.local` (chaves reais) | **Não** — ignorado |
| `.env.example` (placeholders) | Sim — template seguro |
| Chaves digitadas na UI | Só no **localStorage** do browser |
| `node_modules/`, `.next/`, logs, backups | **Não** |

Regras do repositório:

- Nunca commite `.env`, `.env.local` ou qualquer arquivo com `API_KEY` preenchida.
- Não use `git add -f` em arquivos de ambiente.
- Antes do primeiro push, confira:

```bash
git status
git ls-files --others --exclude-standard
```

A API usa a chave no **servidor** (Authorization Bearer nas chamadas OpenRouter/OpenAI). O front só envia a chave se você a digitou na UI; o ideal em uso local é deixar a chave só no `.env.local`.

## Estrutura

```text
app/
  api/commit-message/route.ts   # git + chamada à IA
  HomeClient.tsx                # UI principal
  page.tsx                      # SSR: defaults do env (sem expor chaves)
  layout.tsx
  globals.css
.env.example                    # template público
LICENSE                         # uso livre, sem uso comercial
```

## Licença

**Uso livre para fins pessoais, estudo e projetos sem fins lucrativos.**

Não é permitido vender o app, partes do app, nem ganhar dinheiro com ele (SaaS pago, produto comercial, bundle pago, etc.) sem permissão escrita.

Veja o arquivo [LICENSE](./LICENSE) para os termos completos (mesmo espírito da *Non-Commercial License* usada em outros projetos como o WaterDrop).

Licenças comerciais ou exceções: contato com o autor.

## Autor

**Jubarte** · 2026

---

<p align="center">
  <sub>Feito pra ir rápido no terminal — e ainda commitar com mensagem de gente grande.</sub>
</p>
