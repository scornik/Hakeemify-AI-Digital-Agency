#!/usr/bin/env bash
# Fetch repo metadata, README, top-level tree, package.json into research/raw/<slug>/
cd "$(dirname "$0")"
while IFS='|' read -r cat repo; do
  [ -z "$repo" ] && continue
  slug=$(echo "$repo" | tr '/' '__')
  d="raw/$slug"; mkdir -p "$d"
  echo "$cat" > "$d/category.txt"
  gh api "repos/$repo" > "$d/meta.json" 2>"$d/meta.err" || echo "META FAIL $repo"
  # readme (decoded)
  gh api "repos/$repo/readme" -H "Accept: application/vnd.github.raw" > "$d/README.md" 2>/dev/null || echo "README FAIL $repo"
  # top-level tree
  branch=$(python -c "import json;print(json.load(open('$d/meta.json')).get('default_branch','main'))" 2>/dev/null || echo main)
  gh api "repos/$repo/git/trees/$branch" > "$d/tree.json" 2>/dev/null || echo "TREE FAIL $repo"
  # package.json / pyproject if present
  gh api "repos/$repo/contents/package.json" -H "Accept: application/vnd.github.raw" > "$d/package.json" 2>/dev/null || rm -f "$d/package.json"
  gh api "repos/$repo/contents/pyproject.toml" -H "Accept: application/vnd.github.raw" > "$d/pyproject.toml" 2>/dev/null || rm -f "$d/pyproject.toml"
  # languages
  gh api "repos/$repo/languages" > "$d/languages.json" 2>/dev/null
  echo "ok $repo"
done < repos.txt
