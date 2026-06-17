# Contributing to Infinite

Thanks for your interest in contributing to Infinite. This guide explains how
to set up a local development environment, follow the project's coding
standards, and submit a pull request.

## Code of Conduct

Everyone who participates in this project is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Project Overview

Infinite is a browser-based spatial workspace for development tools. It runs
two processes:

- a Next.js frontend (`http://localhost:3000`)
- an Express + WebSocket relay server (`http://localhost:7891`)

Data is stored in PostgreSQL via Prisma. An optional relay agent can be run on
a separate machine to reach SSH targets that the relay cannot reach directly.

## Local Setup

### 1. Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 14+

### 2. Fork and Clone

```bash
git clone https://github.com/<your-username>/infinite.git
cd infinite
```

### 3. Install Dependencies

```bash
npm install
```

This also runs `patch-package` and `prisma generate` automatically via the
`postinstall` script.

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```env
DATABASE_URL=postgresql://infinite:infinite@localhost:5432/infinite
DIRECT_URL=postgresql://infinite:infinite@localhost:5432/infinite
ENCRYPTION_SECRET=<64-char random hex>
NEXT_PUBLIC_WS_URL=
ALLOWED_ORIGINS=http://localhost:3000
```

Generate a secure encryption secret with:

```bash
openssl rand -hex 32
```

### 5. Initialize the Database

```bash
npm run db:push
```

### 6. Run the App

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Coding Guidelines

- TypeScript for all new code under `src/`, `server/`, and `app/`.
- JavaScript is allowed in `agent/` since the agent ships as a standalone
  script.
- Use the project's ESLint config:

  ```bash
  npm run lint
  ```

  All warnings and errors must be resolved before opening a PR.

- Follow the existing file and component conventions:
  - React components use `.jsx` or `.tsx`.
  - Zustand stores live under `src/stores/`.
  - Server-side helpers live under `server/lib/`.
  - xterm.js and SSH-specific code lives in `src/apps/` and
    `src/components/`.

- Keep changes small and focused. If your PR touches more than one
  concern, split it.

- Do not commit secrets. Use `.env` for local overrides and keep it out of
  version control (it is already in `.gitignore`).

- When adding or changing a Prisma model, run `npx prisma generate` and
  commit the updated client.

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <subject>

<body>
```

Allowed types include `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, and
`build`. Keep the subject line at or under 50 characters.

## Pull Requests

1. Create a new branch from `master`:

   ```bash
   git checkout -b feat/<short-description>
   ```

2. Make your changes in small, logical commits.

3. Run the checks locally before pushing:

   ```bash
   npm run lint
   npm run build
   ```

4. Push your branch and open a pull request against `master`.

5. Fill in the pull request template. Describe:
   - what changed and why
   - how to test it
   - any breaking changes
   - screenshots or recordings for UI changes

6. Make sure CI is green and a maintainer has reviewed the PR before merging.

## Reporting Bugs

Open a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Node.js version
- Operating system
- PostgreSQL version
- Steps to reproduce
- Expected vs. actual behavior
- Relevant logs or screenshots

## Requesting Features

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.md) and
describe the problem you are trying to solve, not just the solution. The
maintainers may have a different approach in mind.

## Working on the Agent

The relay agent lives in [`agent/`](agent/index.js). It is intentionally a
small Node.js process with its own `package.json`.

```bash
cd agent
npm install
INFINITE_TOKEN=<token> INFINITE_SERVER=ws://localhost:7891 node index.js
```

When changing the agent, also update the corresponding UI in
`src/components/AgentPanel.tsx` and the WebSocket relay logic in
`server/lib/ssh.ts` if the protocol changes.

## Questions

If you are unsure about something, open a discussion or a draft PR. It is
faster and easier to give feedback on a concrete change than on a
hypothetical one.
