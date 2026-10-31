<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo.svg" width="64" height="64" alt="finance-tracker logo">
  </picture>
</p>

<h1 align="center">finance-tracker</h1>

<p align="center">
  A minimal, local-first finance tracker: import bank CSV exports, see where your money goes,<br>
  plan recurring payments and forecast your balance for the months ahead.
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png">
    <img src="docs/screenshots/overview-light.png" alt="Overview with spending by category" width="900">
  </picture>
</p>

## Features

- **Private by design** – one SQLite file, server bound to `127.0.0.1`, no external requests.
- **CSV import** – bank detected automatically, duplicates skipped, pending bookings ignored. Ships with DKB; other banks plug in as importer modules.
- **Payee rules** – turn `AMAZON EU S.A R.L., NIEDERLASSUNG…` into *Amazon* (exact / starts with / contains), for past and future imports.
- **Categories** – two levels; assign a payee once and all its transactions follow.
- **Planning** – recurring payments with amount changes, monthly budgets per category and expected one-off payments.
- **Matching** – bookings are suggested for planned payments; you confirm each link yourself.
- **Forecast** – balance for 1 to 36 months, broken down month by month.
- Light & dark theme, English & German.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/transactions-dark.png">
    <img src="docs/screenshots/transactions-light.png" alt="Transactions with the edit panel" width="900">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/planning-dark.png">
    <img src="docs/screenshots/planning-light.png" alt="Recurring payments with status and amount changes" width="900">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/matching-dark.png">
    <img src="docs/screenshots/matching-light.png" alt="Matching bookings to planned payments" width="900">
  </picture>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/forecast-dark.png">
    <img src="docs/screenshots/forecast-light.png" alt="Balance forecast" width="900">
  </picture>
</p>

## Getting started

Requires **Node.js ≥ 22.13** (uses the built-in `node:sqlite`).

```bash
npm install
npm start        # builds and serves http://localhost:4321
npm run demo     # same, with twelve months of invented demo data
```

Your data lives in `data/finance.db` (`FT_DB` to change it, `PORT` for the port). Back it up by copying the file or via *Export backup*.

For development: `npm run dev` (Vite + API with hot reload), `npm test`, `npm run typecheck`.

## Adding a bank

An importer is a small module with `detect(text)` and `parse(text)` that returns rows in a common format
(date, amount in cents, counterparty, purpose, …). Add it under [`src/server/importers/`](src/server/importers/),
register it in `index.ts` and add an anonymised sample to `tests/fixtures/`. See [`dkb.ts`](src/server/importers/dkb.ts) for an example.

## Project layout

```
src/shared   domain logic without I/O: rules, plans, matching, forecast, stats
src/server   Hono API, SQLite store and migrations, importers, demo data
src/client   React frontend (Vite)
tests        Vitest with an anonymised CSV fixture
```
