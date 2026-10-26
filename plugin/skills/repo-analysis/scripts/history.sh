#!/bin/bash
# history.sh — commit and changelog facts over time. Changes nothing.
# Usage: history.sh [project-dir] [days]   (default: current dir, 30 days)
#
# Three questions this answers:
#   1. How does the commit shape change over time (types, sizes, batching)?
#   2. How much of the shipped work is reverted soon after (rework rate)?
#   3. Does every user-visible change get a changelog entry (doc pairing)?

cd "${1:-.}" || exit 1
DAYS="${2:-30}"
start=$(date +%s)

echo "=== Volume ==="
total=$(git log --since="${DAYS} days ago" --oneline 2>/dev/null | wc -l | tr -d ' ')
echo "commits in last $DAYS days: $total"
if [ "$total" -eq 0 ]; then
  echo ""
  echo "=== history: $(( $(date +%s) - start ))s ==="
  exit 0
fi

echo ""
echo "=== Commit types ==="
git log --since="${DAYS} days ago" --pretty=format:"%s" 2>/dev/null \
  | grep -oE '^[a-z]+(\([^)]+\))?!?:' | sed 's/(.*)//' | tr -d ':' \
  | sort | uniq -c | sort -rn | awk '{printf "%-12s %5d  %5.1f%%\n", $2, $1, $1*100/'"$total"'}'

echo ""
echo "=== Conventional commit compliance ==="
conv=$(git log --since="${DAYS} days ago" --pretty=format:"%s" 2>/dev/null \
  | grep -cE '^(feat|fix|docs|refactor|test|chore|perf|build|ci|style|revert)(\([^)]+\))?!?: ')
echo "conventional: $conv of $total"
nonconv=$(git log --since="${DAYS} days ago" --pretty=format:"%s" 2>/dev/null \
  | grep -vE '^(feat|fix|docs|refactor|test|chore|perf|build|ci|style|revert)(\([^)]+\))?!?: ' | head -5)
if [ -n "$nonconv" ]; then
  echo "non-conventional examples:"
  echo "$nonconv" | sed 's/^/  /'
fi

echo ""
echo "=== Changelog pairing ==="
# Does every user-visible change (feat, fix) get a changelog entry? An entry reaches the log one of two ways:
# CHANGELOG.md edited in the commit itself (how Weft did it before its changelog store), or a docs(changelog)
# commit Weft writes right after (lib/changelog-write.ts). git log is newest-first, so that commit sits *above*
# the code commit it documents: look back up to 6 lines. refactor is not counted: the user can't see it.
log_lines=$(git log --since="${DAYS} days ago" --pretty=format:"@@%s" --name-only 2>/dev/null | awk '
  /^@@/ { if (seen) print s "\t" t; s = substr($0, 3); t = 0; seen = 1; next }
  $0 == "CHANGELOG.md" { t = 1 }
  END { if (seen) print s "\t" t }')
code_count=$(echo "$log_lines" | grep -cE '^(feat|fix)(\(|!|:)')
changelog_count=$(echo "$log_lines" | grep -cE '^docs\(changelog\)')
pairing=$(echo "$log_lines" | awk -F '\t' '
  { subj[NR] = $1; touched[NR] = $2 }
  END {
    inside = 0; after = 0; missing = 0; sample = "";
    for (i = 1; i <= NR; i++) {
      if (subj[i] !~ /^(feat|fix)(\(|!|:)/) continue;
      if (touched[i] == 1) { inside++; continue }
      found = 0;
      for (j = i - 1; j >= 1 && j >= i - 6; j--)
        if (subj[j] ~ /^docs\(changelog\)/) { found = 1; break }
      if (found) after++;
      else { missing++; if (missing <= 10) sample = sample "  " subj[i] "\n" }
    }
    printf "%d %d %d\n%s", inside, after, missing, sample;
  }')
read -r inside after missing <<< "$(echo "$pairing" | head -1)"
echo "feat/fix commits          : $code_count"
echo "changelog commits         : $changelog_count"
echo "entry inside the commit   : $inside"
echo "changelog commit after it : $after"
if [ "$code_count" -gt 0 ]; then
  echo "pairing rate              : $(( (inside + after) * 100 / code_count ))%"
fi

echo ""
echo "=== Undocumented user-visible changes ==="
# feat/fix commits that neither touched CHANGELOG.md nor have a changelog commit within 6 commits of them. One
# feature often lands as several commits under one entry, so this is an upper bound, not a count of features.
echo "$pairing" | tail -n +2 | grep -v '^$'
echo "total: $missing"

echo "=== Authors ==="
git log --since="${DAYS} days ago" --pretty=format:"%an" 2>/dev/null \
  | sort | uniq -c | sort -rn | awk -v t="$total" '{printf "%-24s %5d  %5.1f%%\n", substr($0, index($0,$2)), $1, $1*100/t}'

echo ""
echo "=== Activity by day of week ==="
git log --since="${DAYS} days ago" --date=format:"%a" --pretty=format:"%ad" 2>/dev/null \
  | sort | uniq -c | awk '{printf "%s %5d\n", $2, $1}' \
  | awk '{printf "  %-4s %5d %s\n", $1, $2, substr("########################################################", 1, int($2*60/max))}' \
  2>/dev/null || git log --since="${DAYS} days ago" --date=format:"%a" --pretty=format:"%ad" 2>/dev/null | sort | uniq -c

echo ""
echo "=== Activity by hour ==="
git log --since="${DAYS} days ago" --date=format:"%H" --pretty=format:"%ad" 2>/dev/null \
  | sort | uniq -c | awk '{printf "%s %5d\n", $2, $1}'

echo ""
echo "=== Commit batching ==="
# Median gap between commits. A low median with long bursts means
# batch-then-commit; a flat curve means steady drip.
git log --since="${DAYS} days ago" --date=format:"%s" --pretty=format:"%at" 2>/dev/null \
  | awk 'NR>1 { d=$1-p; if (d>0 && d<86400) print d/60 } { p=$1 }' | sort -n \
  | awk '{a[NR]=$1; s+=$1} END {
      if (NR>0) printf "gaps measured: %d\nmedian gap: %.1f min\naverage gap: %.1f min\n", NR, a[int(NR/2)], s/NR
    }'
echo "commits per active hour:"
git log --since="${DAYS} days ago" --date=format:"%Y-%m-%d %H" --pretty=format:"%ad" 2>/dev/null \
  | sort | uniq -c | awk '{sum+=$1; n++; if($1>max)max=$1} END {printf "  active hours: %d\n  avg per active hour: %.1f\n  busiest hour: %d commits\n", n, sum/n, max}'

echo ""
echo "=== Commit size (hand-written source only) ==="
# numstat over all files counts binary and generated churn. Restrict to source
# extensions so the number means something.
git log --since="${DAYS} days ago" --numstat --pretty=format:"COMMIT" 2>/dev/null \
  | awk 'NF==3 && $3 ~ /\.(ts|tsx|cjs|mjs|sql|css|md)$/ && $1!="-" { add+=$1; del+=$2; f++ }
         END { printf "source lines: +%d / -%d\nfiles touched: %d\n", add, del, f }'

echo ""
echo "=== Commit size distribution ==="
git log --since="${DAYS} days ago" --numstat --pretty=format:"COMMIT" 2>/dev/null \
  | awk 'NF==3 && $3 ~ /\.(ts|tsx|cjs|mjs|sql|css|md)$/ && $1!="-" {
      s=$1+$2; if (s<=50) a++; else if (s<=200) b++; else if (s<=500) c++;
      else if (s<=1000) d++; else e++ }
    END { printf "<=50      %5d\n51-200    %5d\n201-500   %5d\n501-1000  %5d\n1001+     %5d\n", a,b,c,d,e }'

echo ""
echo "=== Rework rate (reverts and hotfixes) ==="
# A commit reverted or fixed within 48h is work that had to be redone.
reverts=$(git log --since="${DAYS} days ago" --oneline 2>/dev/null | grep -icE '^(revert|revert:)' || true)
echo "explicit reverts: $reverts"
echo "fix commits that mention a regression from the last day: $(git log --since="${DAYS} days ago" --pretty=format:"%s" 2>/dev/null | grep -ciE 'regression|regressed|again|broke|broken' || true)"

echo ""
echo "=== Releases ==="
git log --since="${DAYS} days ago" --grep="chore(release)" --pretty=format:"  %ad %s" --date=format:"%Y-%m-%d" 2>/dev/null
echo ""
git tag --sort=-creatordate 2>/dev/null | head -5 | sed 's/^/  tag: /'

echo ""
echo "=== Branch and merge strategy ==="
merges=$(git log --since="${DAYS} days ago" --merges --oneline 2>/dev/null | wc -l | tr -d ' ')
echo "merge commits: $merges"
echo "current branch: $(git branch --show-current 2>/dev/null)"
ahead=$(git rev-list --left-right --count origin/$(git branch --show-current 2>/dev/null)...$(git branch --show-current 2>/dev/null) 2>/dev/null)
[ -n "$ahead" ] && echo "ahead/behind origin: $ahead"

echo ""
echo "=== history: $(( $(date +%s) - start ))s ==="
