# Fee calculators

Precise, itemised fee calculators for selling, payment and freelance platforms (Etsy, eBay,
PayPal, Amazon, Stripe, Shopify, Square and more). Every rate cites the platform's official page
and the date it was checked; a daily job re-reads those pages and flags changes.

## Run it

```bash
nvm use 24
npm install
cp .env.example .env.local   # all values optional for local use
npm run dev
```

The calculators work without a database. `DATABASE_URL` enables the contact form, feedback,
error inbox and the owner back office (`/admin`, password `ADMIN_PASSWORD`).

## How it works

- `src/fees/platforms/<slug>.ts`: one module per platform (inputs, `calculate()`, official
  fee schedule, sources, dated changes). Money is integer cents; each fee is rounded per line.
- `src/fees/solve.ts`: "what to charge" mode finds the lowest price that reaches a target.
- `src/components/calculator/`: the interactive calculator UI.
- `scripts/fee-watch.ts`: compares the fee text of every source page with the previous run.

## Checks

```bash
npm run check   # typecheck + lint + unit tests
```

Licensed under the MIT license.
