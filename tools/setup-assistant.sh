#!/usr/bin/env bash
# ─── SKC assistant one-shot setup ────────────────────────────────────────────
# Deploys the skcApi function, wires up the MCP server, and verifies the whole
# chain end to end. Everything it needs is discovered from the repo and from
# your logged-in firebase CLI — you should not have to look anything up.
#
#   ./tools/setup-assistant.sh              full setup (safe to re-run)
#   ./tools/setup-assistant.sh --rotate     replace the API token with a new one
#   ./tools/setup-assistant.sh --verify     just re-check that everything works
#   ./tools/setup-assistant.sh --budget     print the ₹100 budget-alert steps
#
# Re-running is safe: an existing token is reused unless you pass --rotate.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.skc-assistant.env"
DEPLOY_LOG=""
HTTP_BODY=""
BUDGET_INR=100

bold=$(tput bold 2>/dev/null || echo ""); dim=$(tput dim 2>/dev/null || echo "")
red=$(tput setaf 1 2>/dev/null || echo ""); green=$(tput setaf 2 2>/dev/null || echo "")
yellow=$(tput setaf 3 2>/dev/null || echo ""); reset=$(tput sgr0 2>/dev/null || echo "")

step() { printf "\n%s▸ %s%s\n" "$bold" "$1" "$reset"; }
ok()   { printf "  %s✓%s %s\n" "$green" "$reset" "$1"; }
warn() { printf "  %s!%s %s\n" "$yellow" "$reset" "$1"; }
die()  { printf "\n%s✗ %s%s\n" "$red" "$1" "$reset" >&2; exit 1; }

MODE="setup"
for arg in "$@"; do
  case "$arg" in
    --rotate) MODE="rotate" ;;
    --verify) MODE="verify" ;;
    --budget) MODE="budget" ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

# ─── 0. Prerequisites ────────────────────────────────────────────────────────

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

# --verify and --budget only read things, so they need far less installed.
if [[ "$MODE" != "budget" ]]; then
  need node "Install Node 20 or newer from https://nodejs.org"
  need curl "Install curl with your system package manager."
fi
if [[ "$MODE" == "setup" || "$MODE" == "rotate" ]]; then
  need npm "It ships with Node."
  command -v firebase >/dev/null 2>&1 || die \
    "The firebase CLI is not installed. Run: npm install -g firebase-tools"
  command -v openssl >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || die \
    "Need either openssl or python3 to generate a token."
fi

# ─── 1. Discover the project ─────────────────────────────────────────────────

step "Reading project settings"

# .firebaserc has no extension, so it must be read and parsed, not require()d.
PROJECT_ID="$(node -e '
  const fs = require("fs");
  try {
    const rc = JSON.parse(fs.readFileSync(".firebaserc", "utf8"));
    const p = rc.projects || {};
    process.stdout.write(p.default || Object.values(p)[0] || "");
  } catch { process.stdout.write(""); }
' 2>/dev/null || true)"

if [[ -z "$PROJECT_ID" ]] && command -v firebase >/dev/null 2>&1; then
  PROJECT_ID="$(firebase use 2>/dev/null | sed -n 's/.*Active Project: *//p' | tr -d '[:space:]' || true)"
fi
[[ -n "$PROJECT_ID" ]] || die \
  "Could not work out the Firebase project id. Run 'firebase use --add' in this folder, then re-run."
ok "Firebase project: ${bold}${PROJECT_ID}${reset}"

# The region every function is pinned to in functions/src/index.ts.
REGION="$(sed -n 's/.*setGlobalOptions({.*region: "\([a-z0-9-]*\)".*/\1/p' \
  functions/src/index.ts | head -1)"
REGION="${REGION:-asia-south1}"
ok "Region: ${REGION}"

# ─── Budget alert (also reachable on its own via --budget) ───────────────────

print_budget() {
  step "₹${BUDGET_INR} budget alert"
  local billing_account="" project_number=""
  if command -v gcloud >/dev/null 2>&1; then
    billing_account="$(gcloud billing projects describe "$PROJECT_ID" \
      --format='value(billingAccountName)' 2>/dev/null | sed 's#billingAccounts/##' || true)"
    project_number="$(gcloud projects describe "$PROJECT_ID" \
      --format='value(projectNumber)' 2>/dev/null || true)"
  fi

  if [[ -n "$billing_account" && -n "$project_number" ]]; then
    ok "Billing account: ${billing_account}"
    printf "\n  Run this to create the budget:\n\n"
    cat <<BUDGETEOF
    gcloud billing budgets create \\
      --billing-account=${billing_account} \\
      --display-name="SKC INR${BUDGET_INR} cap" \\
      --budget-amount=${BUDGET_INR}INR \\
      --filter-projects="projects/${project_number}" \\
      --threshold-rule=percent=0.5 \\
      --threshold-rule=percent=0.9 \\
      --threshold-rule=percent=1.0 \\
      --threshold-rule=percent=1.0,basis=forecasted-spend
BUDGETEOF
    printf "\n  %sNeeds the Billing Account Administrator role.%s\n" "$dim" "$reset"
  else
    warn "Could not read your billing account automatically."
    printf "    Set it up in the console instead — about two minutes:\n\n"
    printf "    1. https://console.cloud.google.com/billing → pick the account paying for %s\n" "$PROJECT_ID"
    printf "    2. Budgets & alerts → Create budget\n"
    printf "    3. Scope: project %s only\n" "$PROJECT_ID"
    printf "    4. Amount: specified amount, ₹%s\n" "$BUDGET_INR"
    printf "    5. Thresholds: 50%%, 90%%, 100%% actual + 100%% forecasted\n"
    printf "    6. Tick 'Email alerts to billing admins and users' → Finish\n"
  fi
  printf "\n  %sA GCP budget emails you; it does not stop spending.%s\n" "$yellow" "$reset"
  printf "  %sYour real runaway guard is maxInstances: 10 in functions/src/index.ts.%s\n" "$dim" "$reset"
}

if [[ "$MODE" == "budget" ]]; then
  print_budget
  exit 0
fi

if [[ "$MODE" == "setup" || "$MODE" == "rotate" ]]; then
  if ! firebase projects:list >/dev/null 2>&1; then
    warn "The firebase CLI is not logged in."
    printf "    Opening the login flow — finish it in your browser, then this continues.\n"
    firebase login || die "firebase login failed. Run 'firebase login' yourself, then re-run this script."
  fi
  ok "firebase CLI is logged in"
fi

# ─── 2. API token ────────────────────────────────────────────────────────────

gen_token() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else python3 -c 'import secrets; print(secrets.token_hex(32))'; fi
}

# Reuse the token already saved locally, so re-runs don't invalidate a working setup.
EXISTING_TOKEN=""
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  EXISTING_TOKEN="$(sed -n 's/^export SKC_API_TOKEN="\(.*\)"$/\1/p' "$ENV_FILE" | head -1)"
fi

if [[ "$MODE" == "verify" || "$MODE" == "budget" ]]; then
  SKC_API_TOKEN="$EXISTING_TOKEN"
elif [[ "$MODE" == "rotate" || -z "$EXISTING_TOKEN" ]]; then
  step "Setting the API token"
  SKC_API_TOKEN="$(gen_token)"
  # --data-file - reads the value from stdin, so the token never lands in your
  # shell history and no prompt has to be answered.
  if printf '%s' "$SKC_API_TOKEN" | \
       firebase functions:secrets:set SKC_API_TOKEN --project "$PROJECT_ID" --data-file - >/dev/null 2>&1; then
    ok "Stored a new token in the SKC_API_TOKEN secret"
  else
    warn "Non-interactive secret write failed — falling back to the interactive prompt."
    printf "    %sPaste this when asked:%s %s\n\n" "$bold" "$reset" "$SKC_API_TOKEN"
    firebase functions:secrets:set SKC_API_TOKEN --project "$PROJECT_ID" \
      || die "Could not set the SKC_API_TOKEN secret."
  fi
else
  step "Reusing the existing API token"
  SKC_API_TOKEN="$EXISTING_TOKEN"
  ok "Found a token in .skc-assistant.env (pass --rotate to replace it)"
fi

[[ -n "$SKC_API_TOKEN" ]] || die \
  "No API token available. Run this script without --verify to create one."

# ─── 3. Deploy ───────────────────────────────────────────────────────────────

FUNCTION_URL=""

if [[ "$MODE" == "setup" || "$MODE" == "rotate" ]]; then
  step "Building and deploying skcApi"
  ( cd functions && npm install --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null ) \
    || die "The functions build failed. Run 'cd functions && npm run build' to see the errors."
  ok "functions build is clean"

  DEPLOY_LOG="$(mktemp)"
  trap 'rm -f "$DEPLOY_LOG"' EXIT
  if ! firebase deploy --only functions:skcApi --project "$PROJECT_ID" 2>&1 | tee "$DEPLOY_LOG"; then
    die "Deploy failed — the log above says why."
  fi
  ok "skcApi deployed"

  # Gen-2 functions are served from Cloud Run, so take the URL the deploy printed
  # rather than guessing at a hostname shape.
  FUNCTION_URL="$(grep -oiE 'https://[a-z0-9._/-]*skcapi[a-z0-9._/-]*' "$DEPLOY_LOG" \
    | head -1 || true)"
fi

# ─── 4. Resolve the function URL ─────────────────────────────────────────────

if [[ -z "$FUNCTION_URL" && -f "$ENV_FILE" ]]; then
  FUNCTION_URL="$(sed -n 's/^export SKC_API_URL="\(.*\)"$/\1/p' "$ENV_FILE" | head -1)"
fi

if [[ -z "$FUNCTION_URL" ]] && command -v gcloud >/dev/null 2>&1; then
  FUNCTION_URL="$(gcloud run services describe skcapi \
    --region "$REGION" --project "$PROJECT_ID" \
    --format='value(status.url)' 2>/dev/null || true)"
fi

if [[ -z "$FUNCTION_URL" ]]; then
  FUNCTION_URL="https://${REGION}-${PROJECT_ID}.cloudfunctions.net/skcApi"
  warn "Could not read the deployed URL; falling back to ${FUNCTION_URL}"
  warn "If the check below fails, copy the real 'Function URL' from the deploy output"
  warn "into .skc-assistant.env and re-run with --verify."
fi
ok "API URL: ${bold}${FUNCTION_URL}${reset}"

# ─── 5. MCP server ───────────────────────────────────────────────────────────

if [[ "$MODE" == "setup" || "$MODE" == "rotate" ]]; then
  step "Building the MCP server"
  ( cd mcp-server && npm install --no-audit --no-fund >/dev/null 2>&1 && npm run build >/dev/null ) \
    || die "The MCP server build failed. Run 'cd mcp-server && npm run build' to see the errors."
  ok "mcp-server/dist is built"
fi

# ─── 6. Save the environment ─────────────────────────────────────────────────

step "Writing .skc-assistant.env"
umask 077
cat > "$ENV_FILE" <<ENVEOF
# SKC assistant credentials — generated by tools/setup-assistant.sh
# Gitignored. Contains a live API token; do not share or commit it.
export SKC_API_URL="${FUNCTION_URL}"
export SKC_API_TOKEN="${SKC_API_TOKEN}"
ENVEOF
chmod 600 "$ENV_FILE"
ok "Saved (readable only by you)"

# ─── 7. Verify ───────────────────────────────────────────────────────────────

step "Checking the API responds"
HTTP_BODY="$(mktemp)"; trap 'rm -f "$DEPLOY_LOG" "$HTTP_BODY"' EXIT
HTTP_CODE="$(curl -sS -o "$HTTP_BODY" -w '%{http_code}' \
  -H "Authorization: Bearer ${SKC_API_TOKEN}" "${FUNCTION_URL}/" 2>/dev/null)" || HTTP_CODE=""
[[ "$HTTP_CODE" =~ ^[0-9]{3}$ ]] || HTTP_CODE="000"

case "$HTTP_CODE" in
  200)
    ok "API answered 200"
    ROUTES="$(node -e '
      const fs = require("fs");
      try {
        const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const r = d.routes || {};
        process.stdout.write(`${(r.read||[]).length} read + ${(r.write||[]).length} write routes`);
      } catch { process.stdout.write("(could not parse the route list)"); }
    ' "$HTTP_BODY")"
    ok "$ROUTES"
    ;;
  401|403)
    die "The API rejected the token (HTTP ${HTTP_CODE}). The deployed secret and the local token differ — re-run with --rotate." ;;
  404)
    die "HTTP 404 at ${FUNCTION_URL}. The URL is wrong; copy the 'Function URL' from the deploy output into .skc-assistant.env, then re-run with --verify." ;;
  000)
    die "Could not reach ${FUNCTION_URL} at all. Check your network, then re-run with --verify." ;;
  *)
    printf "  %s\n" "$(head -c 300 "$HTTP_BODY")"
    die "Unexpected HTTP ${HTTP_CODE} from the API." ;;
esac

# A real read, to prove Firestore access works and not just the auth layer.
if curl -sS -H "Authorization: Bearer ${SKC_API_TOKEN}" \
     "${FUNCTION_URL}/products" 2>/dev/null | grep -q '"products"'; then
  ok "Firestore read works (products route returned data)"
else
  warn "The products route did not return data — the API is up but check the function logs:"
  warn "  firebase functions:log --only skcApi --project ${PROJECT_ID}"
fi

# ─── 8. Shell profile ────────────────────────────────────────────────────────

step "Making the variables load automatically"
PROFILE=""
case "${SHELL##*/}" in
  zsh)  PROFILE="$HOME/.zshrc" ;;
  bash) [[ -f "$HOME/.bash_profile" ]] && PROFILE="$HOME/.bash_profile" || PROFILE="$HOME/.bashrc" ;;
esac

SOURCE_LINE="[ -f \"${ENV_FILE}\" ] && source \"${ENV_FILE}\"  # SKC assistant"
if [[ -n "$PROFILE" ]]; then
  if grep -qF "$ENV_FILE" "$PROFILE" 2>/dev/null; then
    ok "Already loaded from ${PROFILE##*/}"
  elif printf '\n%s\n' "$SOURCE_LINE" >> "$PROFILE" 2>/dev/null; then
    ok "Added to ${PROFILE##*/}"
  else
    warn "Could not write to ${PROFILE} — add this line yourself:"
    printf "    %s\n" "$SOURCE_LINE"
  fi
else
  warn "Unrecognised shell — add this line to your shell profile yourself:"
  printf "    %s\n" "$SOURCE_LINE"
fi


print_budget

# ─── Done ────────────────────────────────────────────────────────────────────

printf "\n%s%s Setup complete.%s\n\n" "$bold" "$green" "$reset"
printf "  Load the variables into this shell:\n"
printf "    %ssource %s%s\n\n" "$bold" "$ENV_FILE" "$reset"
printf "  Then restart Claude Code and check %s/mcp%s — 'skc' should be connected.\n" "$bold" "$reset"
printf "  Try it with a bill, in Kannada:\n"
printf "    %sಕಡಲೆಕಾಯಿ 5 ಕೆಜಿ 1000 ರೂ, ಬೆಲ್ಲ 2 ಕೆಜಿ 130 ರೂ — ಇವತ್ತಿನ ಬಿಲ್ ಸೇರಿಸು%s\n\n" "$dim" "$reset"
