#!/bin/bash
# docs-drift.sh — check the docs against the code. Changes nothing.
# Usage: docs-drift.sh [project-dir]   (default: current dir)
#
# Weft documents itself heavily: docs/architecture/ carries the map, and every
# doc names real files and real functions. The failure mode is not missing
# docs, it is docs that quietly stopped being true. This checks the three ways
# that happens:
#
#   1. a path the doc names no longer exists
#   2. a symbol the doc names no longer exists
#   3. a source directory no doc mentions
#
# It also finds numbers in docs that the code has since outgrown.

cd "${1:-.}" || exit 1
start=$(date +%s)

DOC_DIR="docs/architecture"
[ -d "$DOC_DIR" ] || DOC_DIR="docs"

echo "=== Docs inventory ==="
docs=$(find "$DOC_DIR" -name '*.md' 2>/dev/null | sort)
if [ -z "$docs" ]; then
  echo "(no docs found under $DOC_DIR)"
  echo ""
  echo "=== docs-drift: $(( $(date +%s) - start ))s ==="
  exit 0
fi
for d in $docs; do
  printf '%6s  %s\n' "$(wc -l < "$d" | tr -d ' ')" "$d"
done
echo "total docs: $(echo "$docs" | grep -c .)"

echo ""
echo "=== 1. Paths named in docs that no longer exist ==="
# Pull backtick-quoted or bare path-like tokens ending in a known source
# extension, then check them against the tree.
broken=0
broken_list=""
for d in $docs; do
  ddir=$(dirname "$d")
  # Relative paths in a doc are usually relative to the doc's own directory,
  # then to the repo root. Try both.
  grep -oE '`[A-Za-z0-9_./@-]+\.(ts|tsx|cjs|mjs|sql|md|json|css|html|sh)`' "$d" 2>/dev/null \
    | tr -d '`' | sort -u | while read -r p; do
      if [ -e "$p" ] || [ -e "$ddir/$p" ]; then continue; fi
      # Skip obvious globs and template names.
      case "$p" in *'*'*|*'<'*|*'>'*) continue ;; esac
      case "$p" in
        node_modules/*|dist/*|build/*) continue ;;
      esac
      # A bare filename like `runner.ts` may live in lib/ — check if it exists
      # anywhere in the tree before calling it broken.
      bn=$(basename "$p")
      if git ls-files 2>/dev/null | grep -qE "(^|/)${bn}$"; then continue; fi
      echo "$d|$p"
    done
done | sort -u > /tmp/.drift_paths.$$
if [ -s /tmp/.drift_paths.$$ ]; then
  while IFS='|' read -r doc path; do
    echo "  $doc -> $path"
  done < /tmp/.drift_paths.$$
  broken=$(wc -l < /tmp/.drift_paths.$$ | tr -d ' ')
fi
rm -f /tmp/.drift_paths.$$
echo "broken path references: $broken"

echo ""
echo "=== 2. Symbols named in docs that no longer exist ==="
# Look for `functionName()` in backticks, then check the symbol appears in
# some source file. A renamed function leaves the doc behind.
sym_missing=0
sym_list=""
for d in $docs; do
  grep -oE '`[a-zA-Z_][a-zA-Z0-9_]*\(\)`' "$d" 2>/dev/null | tr -d '`()' | sort -u | while read -r sym; do
    # Skip obvious prose words and JS builtins.
    case "$sym" in
      if|for|while|return|new|typeof|await|async|function|const|let|var|try|catch) continue ;;
    esac
    if git ls-files '*.ts' '*.tsx' '*.cjs' '*.mjs' 2>/dev/null | xargs grep -ql "\b${sym}\b" 2>/dev/null; then continue; fi
    echo "$d|$sym"
  done
done | sort -u > /tmp/.drift_syms.$$
if [ -s /tmp/.drift_syms.$$ ]; then
  while IFS='|' read -r doc sym; do
    echo "  $doc -> $sym()"
  done < /tmp/.drift_syms.$$
  sym_missing=$(wc -l < /tmp/.drift_syms.$$ | tr -d ' ')
fi
rm -f /tmp/.drift_syms.$$
echo "missing symbols: $sym_missing"

echo ""
echo "=== 3. Source directories no doc mentions ==="
src_dirs=$(git ls-files 2>/dev/null | grep -E '\.(ts|tsx|cjs|mjs)$' \
  | grep -vE '\.(test|spec)\.' | cut -d/ -f1 | sort -u)
undocumented=0
for sd in $src_dirs; do
  # A directory counts as documented if any doc mentions its name.
  if echo "$docs" | xargs grep -ql "\b${sd}\b" 2>/dev/null; then continue; fi
  echo "  $sd/ — no doc under $DOC_DIR mentions it"
  undocumented=$((undocumented + 1))
done
echo "undocumented top-level dirs: $undocumented"

echo ""
echo "=== 4. Numbers in docs the code has outgrown ==="
# Docs often say "N files" or "N lines". If the code says otherwise, the doc
# is stale in the way readers trust least.
stale=0
for d in $docs; do
  # "12 files" / "12 modules" claims
  grep -oE '\b[0-9]+ (files|modules|components|routes|tests|endpoints)\b' "$d" 2>/dev/null | while read -r claim; do
    n=$(echo "$claim" | grep -oE '^[0-9]+')
    noun=$(echo "$claim" | awk '{print $2}')
    case "$noun" in
      files|modules|components|routes|tests)
        actual=$(git ls-files 2>/dev/null | grep -E '\.(ts|tsx|cjs|mjs)$' | grep -vE '\.(test|spec)\.' | wc -l | tr -d ' ')
        tactual=$(git ls-files 2>/dev/null | grep -E '\.(test|spec)\.[a-z]+$' | wc -l | tr -d ' ')
        case "$noun" in
          tests) actual=$tactual ;;
        esac
        if [ "$n" -gt 0 ] && [ "$n" -lt "$actual" ]; then
          echo "  $d: claims '$claim' — tree now has $actual"
        fi
        ;;
    esac
  done
done | sort -u | head -20
stale=$(echo "$docs" | xargs grep -ohE '\b[0-9]+ (files|modules|components|routes|tests)\b' 2>/dev/null | wc -l | tr -d ' ')
echo "numeric claims scanned: $stale"

echo ""
echo "=== 5. Doc freshness ==="
# How long since each doc was last touched, against how long since the code
# it documents was touched. A doc untouched since before a feature landed is
# the one most likely to be wrong.
for d in $docs; do
  dm=$(git log -1 --format=%at -- "$d" 2>/dev/null)
  [ -z "$dm" ] && continue
  # Newest commit touching any file the doc names.
  newest=0
  for p in $(grep -oE '`[A-Za-z0-9_./@-]+\.(ts|tsx|cjs|mjs|sql)`' "$d" 2>/dev/null | tr -d '`' | head -5); do
    bm=$(git log -1 --format=%at -- "$p" 2>/dev/null)
    [ -n "$bm" ] && [ "$bm" -gt "$newest" ] && newest=$bm
  done
  if [ "$newest" -gt "$dm" ]; then
    days=$(( (newest - dm) / 86400 ))
    if [ "$days" -ge 2 ]; then
      printf '  %-45s doc %3dd old, code %3dd newer\n' "$d" "$days" "$days"
    fi
  fi
done | head -20

echo ""
echo "=== docs-drift: $(( $(date +%s) - start ))s ==="
