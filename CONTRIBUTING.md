# Contributing to ConvoxOS

ConvoxOS is a CRM/operations platform with a unified Inbox and a
modular channel direction (WhatsApp as the existing core, Telegram as
the first external module). This is the product repository, not a
generic template.

## Run locally

```bash
git clone https://github.com/FAIZANKHAN10X/ConvoxOS.git
cd ConvoxOS
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm install
npm run dev
```

Setup details live in [`README.md`](./README.md). Docker is documented
in [`docs/docker.md`](./docs/docker.md).

## Reporting bugs

Use a [bug report](https://github.com/FAIZANKHAN10X/ConvoxOS/issues/new?template=bug_report.yml).
Include the commit SHA, the runtime (local / Docker / other), and
relevant logs.

## Reporting security issues

**Do not file security issues publicly.** Follow
[SECURITY.md](./.github/SECURITY.md).

## Pull requests

Useful PRs:

- Security fixes (follow SECURITY.md first for disclosure)
- Bug fixes and correctness
- Documentation that matches actual behavior
- Small, in-scope improvements (accessibility, obvious UX nits)

Please open an issue first for non-trivial work so we can check
alignment.

PR hygiene:

- Branch off the latest `main`
- Run `npm run typecheck` and `npm run format` locally
- Fill in the PR template, especially the **Test plan**
- One logical change per PR
- Commit-message first line is imperative and terse; the body explains
  the *why*

Architecture constraints that usually do **not** belong in a PR:

- Adding `Conversation.channel` or a `channels` table
- Introducing a generic `ChannelSender` / factory / registry
- Rewriting the existing WhatsApp system to add a new channel

See [`ROADMAP.md`](./ROADMAP.md) for product direction.

## Dev-loop reference

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on port 3000. |
| `npm run build` | Production build. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run format` | Prettier write. |
| `npm run format:check` | Prettier check-only. |
| `npm test` | Vitest. |

## Licensing

ConvoxOS is MIT ([`LICENSE`](./LICENSE)). Contributions are assumed to
be MIT as well.
