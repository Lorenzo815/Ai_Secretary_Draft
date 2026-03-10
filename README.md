# AI Secretary Draft

Product concept and interactive prototype for a WhatsApp-first AI secretary platform.

This repository contains:
- Business and product strategy draft (`initial_draft/main_ideas.md`)
- Next.js prototype UI (`initial_draft/ui-app`)
- GitHub Pages deployment workflow (`.github/workflows/deploy-pages.yml`)

## Project Goals

- Validate the practical product vision with clickable pages
- Demonstrate MVP user journeys (onboarding, operations, costs, billing)
- Keep deployment simple with static export + GitHub Pages

## Current Prototype Scope

Main implemented pages (MVP):
- Onboarding Wizard
- Home / Executive Dashboard
- Inbox (Omnichannel conversations)
- Flow Builder (visual low-code mock)
- Canais (WhatsApp-first)
- Custos (cost transparency)
- Billing / Plano

## Repository Structure

```text
.
|- .github/
|  \- workflows/
|     \- deploy-pages.yml
|- initial_draft/
|  |- main_ideas.md
|  \- ui-app/
|     |- app/
|     |- lib/
|     |- package.json
|     \- next.config.mjs
\- README.md
```

## Run Locally

From the repository root:

```bash
cd initial_draft/ui-app
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production Build

```bash
cd initial_draft/ui-app
npm run build
```

Static output is generated at `initial_draft/ui-app/out/`.

## Deploy to GitHub Pages

Deployment is automated through GitHub Actions.

1. Push to `main`
2. Go to `Settings > Pages`
3. Set `Source` to `GitHub Actions`
4. Wait for workflow `Deploy UI App to GitHub Pages`

Expected URL:
- `https://lorenzo815.github.io/Ai_Secretary_Draft/`

## Notes

- The UI project has its own app-level documentation at `initial_draft/ui-app/README.md`.
- `next.config.mjs` is already configured for static export and repository base path handling in GitHub Actions.