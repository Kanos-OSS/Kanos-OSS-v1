# Kanos OSS

The open-source AI pricing engine behind [Kanos](https://kanos.biz).

Give it a product URL, a product name, or a plain-English business description and it returns a structured, defensible pricing recommendation: an optimal price, a chosen pricing framework with rationale, real-world competitors with ratings, a customer persona, demand signals, and a profit simulation. It works for both **online / e-commerce** products and **in-person / local** businesses (with location-aware competitor research).

This repository is the **backend framework** only. The hosted web UI is not included. You drive it through a small HTTP API (or embed the modules directly).

## What's inside

- **Pricing analysis pipeline** - a multi-step autonomous flow: optional internal-data extraction → deep market research → local competitor research → a final structured pricing report.
- **Headless API** - `POST /api/agent/analyze` with an API key. No browser required.
- **Persistence** - PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/).
- **Scheduler** - recurring re-analysis (daily / weekly / monthly).
- **Shopify integration** - connect a store and push recommended prices to product variants.
- **Report chat** - ask follow-up questions grounded in a specific report.
- **Pluggable models** - any OpenAI-compatible endpoint. Defaults to `minimax/minimax-m2.5` via OpenRouter for text, with an optional vision endpoint for reading uploaded images.

## Architecture

```
server/
  index.ts          Express app, sessions, optional Google OAuth, root info route
  routes.ts         API routes + the pricing analysis engine
  openai.ts         OpenAI-compatible client setup + model selection
  web-research.ts   Autonomous market + local competitor research
  chat.ts           Report-grounded chat (system prompt builder)
  scheduler.ts      Background scheduler for recurring analyses
  shopify.ts        Shopify Admin API helpers
  storage.ts        Database access layer (Drizzle)
  db.ts             Database connection
  seed.ts           Sample data on first boot
  prompts/          Prompt templates
shared/
  schema.ts         Drizzle schema + shared TypeScript types
  models/chat.ts    Chat tables
scripts/
  create-api-key.ts Mint an API key without the web UI
```

## Do I need a database?

No. The pricing engine is the AI layer, not the database.

- **Without `DATABASE_URL`** (the simple path): the server runs with an in-memory store. The stateless pricing API works with just `MINIMAX_KEY` and a static `API_KEY`. State (history, schedules, chat) is kept in memory and lost on restart.
- **With `DATABASE_URL`**: you get persistence: saved analysis history, scheduled monitoring, report chat, minted API keys, and the Google OAuth login flow.

Pick whichever fits. The endpoints are identical.

## Quick start (no database)

Requires Node 20+ only.

```bash
npm install
cp .env.example .env     # set MINIMAX_KEY and API_KEY (any secret you choose)
npm run dev              # server on http://localhost:15000

curl -X POST http://localhost:15000/api/agent/analyze \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"productInput":"Premium ceramic coffee mug","currentPrice":18.99}'
```

## Quick start (Docker, with Postgres)

Brings up Postgres and the server together for the full persistent app.

```bash
cp .env.example .env
# put your model API key in .env:  MINIMAX_KEY=sk-or-...

docker compose up --build
```

The server comes up on <http://localhost:15000>. Then mint a key and call it:

```bash
docker compose exec app npm run create-api-key -- demo

curl -X POST http://localhost:15000/api/agent/analyze \
  -H "Authorization: Bearer <key-from-previous-command>" \
  -H "Content-Type: application/json" \
  -d '{"productInput":"Premium ceramic coffee mug","currentPrice":18.99}'
```

## Quick start (local Node, with Postgres)

Requires Node 20+ and a reachable PostgreSQL database.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and MINIMAX_KEY
npm run db:push               # create tables
npm run create-api-key -- demo
npm run dev                   # server on http://localhost:15000
```

## Configuration

All configuration is via environment variables (see [`.env.example`](.env.example)).

| Variable | Required | Purpose |
| --- | --- | --- |
| `MINIMAX_KEY` | yes | API key for the OpenAI-compatible text model (OpenRouter by default) |
| `API_KEY` | for headless use | Static bearer token for `POST /api/agent/analyze`; required when running DB-free |
| `DATABASE_URL` | no | PostgreSQL connection string. Omit to run with an in-memory store |
| `PORT` | no | Listen port (default `15000`) |
| `SESSION_SECRET` | no | Cookie signing secret (set in production) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | no | Enable the browser Google login flow |
| `OAUTH_CALLBACK_URL` | no | Your deployed OAuth callback URL |
| `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` | no | Vision model for reading uploaded images |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | no | Shopify OAuth "connect store" flow |

No secrets are committed to this repository - every credential is read from the environment.

### Choosing a model

`server/openai.ts` defines the clients and exports `AI_MODEL`. Point `MINIMAX_KEY` and the base URL at any OpenAI-compatible provider, and change `AI_MODEL` to the model you want.

## The headless API

The primary integration point is the agent endpoint, authenticated with an API key (`Authorization: Bearer <key>`).

### `POST /api/agent/analyze`

Request body:

```json
{
  "productInput": "https://example-shop.com/products/widget",
  "businessType": "online",
  "businessLocation": null,
  "currentPrice": 29.99
}
```

- `productInput` (required) - a URL, product name, or business description.
- `businessType` - `"online"` (default) or `"in_person"`.
- `businessLocation` - city / neighborhood; used for local competitor research when `businessType` is `"in_person"`.
- `currentPrice` - your current price. Omit it to get launch pricing for a new product.

Response (abridged):

```json
{
  "result": {
    "productName": "...",
    "productCategory": "...",
    "currentPrice": 29.99,
    "optimalPrice": 27.99,
    "marketAverage": 28.5,
    "marketPosition": "Mid-range",
    "revenueImpact": "+8%",
    "profitImpact": "+12%",
    "summary": "...",
    "keyInsight": "...",
    "recommendedAction": "...",
    "competitors": [],
    "localCompetitors": [],
    "demandSignals": {},
    "customerPersona": {}
  }
}
```

### Other routes

Session-authenticated routes (used by a frontend or via the Google OAuth flow) are also available, including analyses CRUD + SSE progress (`/api/analyses`), scheduled monitors (`/api/schedules`), API key management (`/api/api-keys`), report chat (`/api/analyses/:id/chat`), and Shopify (`/api/shopify/*`). See `server/routes.ts`.

## How the pricing engine works

1. **Extract internal data** (if files are uploaded) - text extraction for documents, a vision model for images.
2. **Deep market research** - if the input is a URL, the page is fetched and cleaned; an AI pass researches real competitors, prices, and market data.
3. **Local competitor research** - for in-person businesses with a location, nearby competitors are researched with addresses, distances, and ratings.
4. **Final analysis** - a single structured prompt combines everything and selects a pricing framework (Value-Based, Competitive, Cost-Plus, or Psychological) with explicit rationale, then returns the JSON report.

## Development

```bash
npm run check     # type-check
npm run build     # bundle server -> dist/index.cjs
npm start         # run the production bundle
```

## License

[MIT](LICENSE)
