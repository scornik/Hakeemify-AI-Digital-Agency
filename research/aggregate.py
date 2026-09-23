"""Aggregate research/repos/*.json into repo-analysis.json and REPO-MATRIX.md."""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPOS = os.path.join(HERE, "repos")

REQUIRED = [
    "repo", "category", "core_innovation", "strengths", "weaknesses",
    "patterns_to_steal", "patterns_to_avoid", "adoption_strategy",
    "novelty_score", "difficulty_score",
]

CATEGORY_ORDER = [
    "ai-website-builders", "visual-editors", "ui-components", "motion",
    "3d-webgl", "design-systems", "agents", "browser-qa", "cms", "quality",
]


def cat_key(c: str) -> int:
    for i, k in enumerate(CATEGORY_ORDER):
        if c.startswith(k):
            return i
    return len(CATEGORY_ORDER)


rows = []
problems = []
for path in sorted(glob.glob(os.path.join(REPOS, "*.json"))):
    try:
        with open(path, encoding="utf-8") as f:
            j = json.load(f)
    except Exception as e:  # noqa: BLE001
        problems.append(f"{os.path.basename(path)}: invalid JSON ({e})")
        continue
    missing = [k for k in REQUIRED if k not in j]
    if missing:
        problems.append(f"{os.path.basename(path)}: missing {missing}")
    rec = j.get("recommendation") or j.get("adoption_strategy", "").split()[0].rstrip(".,:;")
    j["recommendation"] = rec
    rows.append(j)

rows.sort(key=lambda r: (cat_key(r.get("category", "")), -int(r.get("stars") or 0)))

with open(os.path.join(HERE, "repo-analysis.json"), "w", encoding="utf-8") as f:
    json.dump(rows, f, indent=2, ensure_ascii=False)

# Matrix
lines = ["# Repository Analysis Matrix", "",
         f"{len(rows)} repositories analysed. Scores: novelty (N) and implementation difficulty (D), 0-10.", "",
         "| # | Repo | Category | Stars | License | Rec | N | D | Core innovation |",
         "|---|---|---|---|---|---|---|---|---|"]
for i, r in enumerate(rows, 1):
    ci = (r.get("core_innovation") or "").replace("|", "/")
    if len(ci) > 140:
        ci = ci[:137] + "..."
    lines.append(
        f"| {i} | [{r['repo']}]({r.get('url', '')}) | {r.get('category', '')} | {r.get('stars', '')} | "
        f"{r.get('license', '')} | **{r['recommendation']}** | {r.get('novelty_score', '')} | "
        f"{r.get('difficulty_score', '')} | {ci} |"
    )

# Recommendation counts
from collections import Counter  # noqa: E402
c = Counter(r["recommendation"] for r in rows)
lines += ["", "## Recommendation counts", ""] + [f"- **{k}**: {v}" for k, v in c.most_common()]

# Top by novelty
lines += ["", "## Highest novelty (>= 7)", ""]
for r in sorted(rows, key=lambda r: -int(r.get("novelty_score") or 0)):
    if int(r.get("novelty_score") or 0) >= 7:
        lines.append(f"- **{r['repo']}** ({r['novelty_score']}/{r['difficulty_score']}, {r['recommendation']}): {r.get('core_innovation', '')}")

with open(os.path.join(HERE, "REPO-MATRIX.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")

print(f"{len(rows)} repos aggregated -> repo-analysis.json, REPO-MATRIX.md")
for p in problems:
    print("PROBLEM:", p)
if problems:
    sys.exit(1)
