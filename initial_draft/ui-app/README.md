# AI Secretary UI App

Basic Next.js UI prototype generated from `initial_draft/main_ideas.md`.

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Build for production

```bash
npm run build
```

The static export is generated in `out/`.

## Publish to GitHub Pages

This repository already includes a workflow at `.github/workflows/deploy-pages.yml`.

1. Push changes to the `main` branch.
2. In GitHub, open `Settings > Pages`.
3. Set `Source` to `GitHub Actions`.
4. Wait for the workflow `Deploy UI App to GitHub Pages` to finish.

Published URL pattern:
- `https://<your-user>.github.io/Ai_Secretary_Draft/`

## Included sections

- Hero and positioning
- Core differentiators
- Pricing snapshot
- 12-month roadmap
- Key business KPIs

## Project structure

- `app/page.tsx`: Main one-page UI
- `app/globals.css`: Theme and responsive layout
- `lib/content.ts`: Structured content extracted from your business plan
