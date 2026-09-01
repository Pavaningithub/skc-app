# SKC Assistant API & MCP server

How an AI assistant reads and writes SKC bill, raw-material and costing data — **without
any AI running inside the SKC app**.

```
  You (Kannada / English)
        │
   Claude Code  ──  .claude/skills/skc/SKILL.md   (how to behave, language, safety)
        │
   skc MCP server  (mcp-server/)                  (12 typed tools, stdio)
        │  HTTPS + bearer token
   skcApi Cloud Function  (functions/src/skc/)    (auth, validation, all the maths)
        │
   Firestore                                      (the durable record — yours)
```

The API is a plain JSON HTTP service. The MCP server is one client of it; a script, a
spreadsheet job, or a different AI tool can be another. Nothing about the data depends on
Claude.

## What lives where

| File | Role |
|---|---|
| `functions/src/skc/analysis.ts` | Pure costing maths — mirrors the admin Product Costing page |
| `functions/src/skc/bills.ts` | Turning one bill into cost-sheet rates + an impact report |
| `functions/src/skc/store.ts` | Firestore reads and writes |
| `functions/src/skc/api.ts` | Routing, auth, input validation, error messages |
| `mcp-server/src/index.ts` | MCP tool definitions |
| `.claude/skills/skc/SKILL.md` | Kannada-first workflow rules for the assistant |

## Setup

### 1. Deploy the API

```bash
firebase functions:secrets:set SKC_API_TOKEN     # paste a long random string; save it
firebase deploy --only functions:skcApi
```

Generate a token with `openssl rand -hex 32`. It is the only credential — treat it like a
password and never commit it.

The deployed URL looks like:
`https://asia-south1-<project-id>.cloudfunctions.net/skcApi`

### 2. Build the MCP server

```bash
cd mcp-server && npm install && npm run build
```

### 3. Point Claude Code at it

`.mcp.json` in the repo root already registers the server and reads two environment
variables, so the token stays out of git:

```bash
export SKC_API_URL="https://asia-south1-<project-id>.cloudfunctions.net/skcApi"
export SKC_API_TOKEN="<the token from step 1>"
```

Put those in your shell profile, then restart Claude Code. Check with `/mcp` — `skc`
should be listed as connected.

For Claude Desktop or another MCP client, register the same command with the same two
environment variables:

```json
{
  "mcpServers": {
    "skc": {
      "command": "node",
      "args": ["/absolute/path/to/skc-app/mcp-server/dist/index.js"],
      "env": {
        "SKC_API_URL": "https://asia-south1-<project-id>.cloudfunctions.net/skcApi",
        "SKC_API_TOKEN": "<token>"
      }
    }
  }
}
```

## Routes

Auth on every call: `Authorization: Bearer <SKC_API_TOKEN>` (or `X-SKC-Token`).
`GET /` lists the routes. Reads are GET with query parameters; writes are POST with a JSON
body.

### Read

| Route | Purpose |
|---|---|
| `GET /raw-materials` | Every tracked material with its latest rate |
| `GET /raw-material-trends` | Latest vs previous rate per material; `minChangePct`, `limit` |
| `GET /material-history` | Full rate history for one `materialId` |
| `GET /product-costing` | Cost breakdown and suggested price per product; `productId` |
| `GET /margin-suggestions` | Prices for a `targetMarginPct` (default 25) |
| `GET /bill-impact` | Products affected by rate changes; `purchaseId` or `materialIds` |
| `GET /bills` | Recorded bills; `from`, `to`, `limit` |
| `GET /products` | Products, live prices, whether a recipe exists |
| `GET /summary` | Revenue, expenses, profit, pricing alerts; `from`, `to` |

### Write

| Route | Purpose |
|---|---|
| `POST /record-bill` | Record a bill → purchase + batch column + rates + expense |
| `POST /add-raw-material` | Add a cost-sheet row |
| `POST /set-product-price` | Change a live storefront price |

**Every write defaults to `dryRun: true`** and returns a full preview without touching
Firestore. Pass `"dryRun": false` to persist. This is deliberate: the family reviews the
parsed result before anything is saved.

### Example

```bash
curl -s -X POST "$SKC_API_URL/record-bill" \
  -H "Authorization: Bearer $SKC_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-09-01",
    "supplierName": "Sri Ram Traders",
    "items": [
      { "name": "ಕಡಲೆಕಾಯಿ", "quantity": 5, "unit": "kg", "totalCost": 1000 },
      { "name": "ಬೆಲ್ಲ",     "quantity": 2, "unit": "kg", "totalCost": 130  }
    ]
  }'
```

The response reports, per line, the new ₹/kg, the previous ₹/kg and the % change; then
which products got costlier and which need a price review. Re-send with `"dryRun": false`
to save.

## What recording a bill does

1. Matches each line to a cost-sheet material by English name, Kannada name or bill name.
   Unmatched names create a new material row and are listed under `newMaterials` so a human
   can catch spelling variants.
2. Creates a batch column (auto-numbered `B1`, `B2`, …) dated to the bill.
3. Converts each line to ₹ per kg (or per piece) and writes it as that batch's rate.
4. Writes a `rawMaterialPurchases` document, and a `raw_material` expense row.
5. Recomputes every recipe that uses those materials and reports the cost movement.

Costing maths is identical to `src/pages/admin/ProductCostingPage.tsx`, so the admin UI and
the assistant can never disagree.

## Cost

The API runs on Cloud Functions and does zero AI inference — the only cost is invocations
and Firestore reads, which at family scale sits inside the free tier. The assistant's
reasoning is paid for by your Claude Code subscription, not per API call.
