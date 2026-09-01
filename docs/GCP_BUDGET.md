# Setting a ₹100 budget alert on the SKC GCP project

I cannot do this from a Claude Code session: this container has no `gcloud`, no Google
credentials, and no access to your billing account. Budgets also require the
**Billing Account Administrator** role, which is deliberately outside what a repo session
holds. Below is the whole thing — it takes about two minutes.

## Fastest route

`./tools/setup-assistant.sh --budget` reads your project id and, if `gcloud` is installed
and authenticated, your billing account and project number — and prints the exact
`gcloud billing budgets create` command with those filled in. If it cannot reach `gcloud`
it prints the console steps below instead.

## Console (easiest)

1. Open <https://console.cloud.google.com/billing> and pick the billing account that pays
   for the SKC project.
2. **Budgets & alerts** → **Create budget**.
3. **Scope** — set *Projects* to the SKC Firebase project only. Leave services as "All
   services" so a surprise anywhere is caught.
4. **Amount** — Budget type *Specified amount*, **₹100**. (Confirm the billing account's
   currency is INR; if it is USD, use the equivalent, around $1.20.)
5. **Actions** — set threshold rules at **50%, 90%, 100%** of actual spend, and tick
   *Forecasted spend* at 100% so you hear about an overrun before it lands.
6. Tick **Email alerts to billing admins and users**, then Finish.

## gcloud (if you prefer the CLI)

```bash
gcloud billing budgets create \
  --billing-account=XXXXXX-XXXXXX-XXXXXX \
  --display-name="SKC ₹100 cap" \
  --budget-amount=100INR \
  --filter-projects="projects/<skc-project-number>" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

Find the billing account id with `gcloud billing accounts list`, and the project number
with `gcloud projects describe <project-id> --format='value(projectNumber)'`.

## Important: a budget alerts, it does not cap

A GCP budget **emails you** — it does not stop spending. To make it actually stop, wire the
budget to a Pub/Sub topic and a function that disables billing. That is a real safety
tradeoff: disabling billing takes skctreats.in offline. For a business at this scale the
alert alone is usually right, with these limits as the actual protection:

- `setGlobalOptions({maxInstances: 10})` in `functions/src/index.ts` already caps concurrent
  function instances — this is the main runaway-cost guard.
- Only two functions deploy: `notifyNewOrder` and `skcApi`.
- Firestore free tier is 50k reads / 20k writes per day; SKC is far below it.

## Reducing what you deploy

Already done — `notifyNewSubscription`, `weeklyUnpaidSummary` and `telegramWebhook` are
commented out in `functions/src/index.ts`, so only new-order Telegram notifications are
live. If you ever want them back, uncomment the block and redeploy.
