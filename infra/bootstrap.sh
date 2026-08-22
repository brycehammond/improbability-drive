#!/usr/bin/env bash
#
# One-time setup for deploying the Improbability Drive to an Azure account you
# control, from a GitHub repository you control.
#
# It creates a Microsoft Entra application that GitHub Actions signs in as,
# using OIDC federation rather than a stored password, grants it rights over
# one subscription, and writes the repository secrets and variables the
# workflow reads. After this, `git push` deploys.
#
# Prerequisites: `az login`, `gh auth login`, and permission to create app
# registrations in the tenant and role assignments on the subscription.
#
# Everything is configurable through the environment:
#
#   APP_NAME=mydrive AZURE_LOCATION=westeurope ./infra/bootstrap.sh
#
set -euo pipefail

APP_NAME="${APP_NAME:-improbabilitydrive}"
AZURE_LOCATION="${AZURE_LOCATION:-westus2}"
SWA_LOCATION="${SWA_LOCATION:-$AZURE_LOCATION}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-${APP_NAME}-rg}"
SWA_SKU="${SWA_SKU:-Free}"
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-opus-5}"
IDENTITY_NAME="${IDENTITY_NAME:-${APP_NAME}-github}"
BRANCH="${BRANCH:-main}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "This needs $1 on PATH." >&2; exit 1; }; }

need az
need gh

REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"

say "Setting up $REPO to deploy '$APP_NAME' into subscription $SUBSCRIPTION_ID"

# ---------------------------------------------------------------------------
# 1. The identity GitHub Actions signs in as.
# ---------------------------------------------------------------------------
CLIENT_ID="$(az ad app list --display-name "$IDENTITY_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)"
if [[ -z "$CLIENT_ID" ]]; then
  say "Creating the app registration '$IDENTITY_NAME'"
  CLIENT_ID="$(az ad app create --display-name "$IDENTITY_NAME" --query appId -o tsv)"
else
  say "Reusing the existing app registration '$IDENTITY_NAME'"
fi

az ad sp show --id "$CLIENT_ID" >/dev/null 2>&1 || az ad sp create --id "$CLIENT_ID" --output none
OBJECT_ID="$(az ad sp show --id "$CLIENT_ID" --query id -o tsv)"

# ---------------------------------------------------------------------------
# 2. Federated credentials: which GitHub workflows may become that identity.
#    A subject per context; GitHub sends one and Entra checks it against these.
#
#    GitHub is migrating the subject claim from repository *names* to immutable
#    numeric IDs, so the same workflow may present either
#
#      repo:owner/repo:environment:production
#      repo:owner@1234/repo@5678:environment:production
#
#    depending on the repository. Which one you get is not something this
#    script can choose, so it registers both and lets Entra match whichever
#    arrives. The IDs are looked up rather than written down, so this stays
#    correct for any account.
# ---------------------------------------------------------------------------
OWNER_ID="$(gh api "repos/${REPO}" -q .owner.id)"
REPO_ID="$(gh api "repos/${REPO}" -q .id)"
REPO_IMMUTABLE="${REPO%%/*}@${OWNER_ID}/${REPO##*/}@${REPO_ID}"

add_federated_credential() {
  local name="$1" subject="$2"
  if az ad app federated-credential list --id "$CLIENT_ID" --query "[?name=='$name']" -o tsv | grep -q .; then
    echo "  federated credential '$name' already present"
    return
  fi
  echo "  adding federated credential '$name' -> $subject"
  az ad app federated-credential create --id "$CLIENT_ID" --parameters "{
    \"name\": \"$name\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"$subject\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" --output none
}

say "Federating GitHub Actions to that identity"
add_federated_credential "${APP_NAME}-branch-${BRANCH}" "repo:${REPO}:ref:refs/heads/${BRANCH}"
add_federated_credential "${APP_NAME}-environment-production" "repo:${REPO}:environment:production"
add_federated_credential "${APP_NAME}-branch-${BRANCH}-id" "repo:${REPO_IMMUTABLE}:ref:refs/heads/${BRANCH}"
add_federated_credential "${APP_NAME}-environment-production-id" "repo:${REPO_IMMUTABLE}:environment:production"

# ---------------------------------------------------------------------------
# 3. Rights. Contributor over the subscription, because the deployment creates
#    its own resource group. Narrow this to the resource group afterwards if
#    you would rather create the group by hand.
# ---------------------------------------------------------------------------
say "Granting Contributor on the subscription"
az role assignment create \
  --assignee-object-id "$OBJECT_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "/subscriptions/${SUBSCRIPTION_ID}" \
  --output none 2>/dev/null || echo "  already granted"

# ---------------------------------------------------------------------------
# 4. Tell the repository who it is and where it is going.
# ---------------------------------------------------------------------------
say "Writing repository secrets and variables"
gh secret set AZURE_CLIENT_ID --repo "$REPO" --body "$CLIENT_ID"
gh secret set AZURE_TENANT_ID --repo "$REPO" --body "$TENANT_ID"
gh secret set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUBSCRIPTION_ID"

gh variable set APP_NAME --repo "$REPO" --body "$APP_NAME"
gh variable set AZURE_LOCATION --repo "$REPO" --body "$AZURE_LOCATION"
gh variable set SWA_LOCATION --repo "$REPO" --body "$SWA_LOCATION"
gh variable set AZURE_RESOURCE_GROUP --repo "$REPO" --body "$AZURE_RESOURCE_GROUP"
gh variable set SWA_SKU --repo "$REPO" --body "$SWA_SKU"
gh variable set ANTHROPIC_MODEL --repo "$REPO" --body "$ANTHROPIC_MODEL"

# The one thing this script will not invent for you.
if gh secret list --repo "$REPO" --json name -q '.[].name' 2>/dev/null | grep -qx ANTHROPIC_API_KEY; then
  say "ANTHROPIC_API_KEY is already set"
else
  say "Last step: the Anthropic API key"
  cat <<EOF
The deployment needs an Anthropic API key, which is held as a Static Web App
application setting and never reaches a browser. Set it with:

  gh secret set ANTHROPIC_API_KEY --repo $REPO

Then push to $BRANCH, or run: gh workflow run Deploy --repo $REPO
EOF
fi

say "Done."
