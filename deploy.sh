#!/usr/bin/env bash
# One-command build and deploy.
#
#   ./deploy.sh
#
# What it does:
#   1. Fetches the public Taskmarket API on this machine and writes data/site.json.
#   2. Renders the six 1200x630 share cards (needs Chrome and ffmpeg).
#   3. Generates the six static share pages in s/.
#   4. Commits, pushes, enables GitHub Pages and starts the refresh workflow.
#
# Requirements: Node 20+, git, and the GitHub CLI (gh) authenticated once with
# `gh auth login`. Chrome and ffmpeg are needed for the share cards; without
# them the build keeps the cards already in assets/og/.
#
# Overrides: REPO, OWNER, BRANCH, SITE_URL.

set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node 20 or newer is required: https://nodejs.org" >&2
  exit 1
fi

echo "== 1/4 Collecting market data (server-side)"
node scripts/collect.mjs data/site.json

echo "== 2/4 Rendering share cards"
if ! node scripts/og.mjs; then
  echo "!! Chrome was not available, keeping the existing cards in assets/og/"
fi

echo "== 3/4 Generating share pages"
node scripts/share.mjs

echo "== 4/4 Publishing"
if ! command -v gh >/dev/null 2>&1; then
  cat <<'EOF'
GitHub CLI (gh) not found, so the build is ready but not published.
Push this directory to a public repository, then in Settings > Pages choose
"GitHub Actions" and run the "Refresh and deploy" workflow once.
EOF
  exit 0
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Run 'gh auth login' once, then re-run this script." >&2
  exit 1
fi

REPO="${REPO:-taskmarket-pulse}"
BRANCH="${BRANCH:-main}"
OWNER="${OWNER:-$(gh api user --jq .login)}"

if [ ! -d .git ]; then
  git init -q
  # git 2.25 has no `git init -b`; create the branch explicitly instead.
  git checkout -q -b "$BRANCH" 2>/dev/null || git symbolic-ref HEAD "refs/heads/$BRANCH"
fi

git add -A
git commit -m "Refresh Taskmarket in the open: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >/dev/null 2>&1 || true

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Creating public repository $OWNER/$REPO"
  gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push
elif ! git push -u origin "$BRANCH"; then
  echo "Could not push to origin (no permission). Creating $OWNER/$REPO instead."
  git remote remove origin || true
  gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push
fi

# Pages must build from Actions so the hourly workflow can deploy new data.
if ! gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 \
    || echo "Could not enable Pages automatically. Set Settings > Pages > Source: GitHub Actions."
fi

gh workflow run refresh.yml --ref "$BRANCH" >/dev/null 2>&1 \
  || echo "Workflow dispatch skipped; the push to $BRANCH starts the first deploy."

echo
echo "Published: https://$OWNER.github.io/$REPO/"
echo "The refresh workflow runs hourly at :17 UTC."
