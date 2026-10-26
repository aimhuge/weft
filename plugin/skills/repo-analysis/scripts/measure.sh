#!/bin/bash
# measure.sh — repo-wide size, shape and coupling facts. Changes nothing.
# Usage: measure.sh [project-dir]   (default: current dir)
#
# Counts only tracked files, so node_modules and build output never inflate a
# number. Reports hand-written source separately from generated and binary
# files, because `git diff --numstat` counts a 50 KB font as ~1000 lines and
# that flatters every churn number it touches.
#
# Test files are counted separately from source, never folded in: a repo with
# one test per module has a very different shape from one without, and mixing
# them hides both.

cd "${1:-.}" || exit 1
start=$(date +%s)
export LC_ALL=C

SRC_RE='\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|scala|ex|exs|sh|sql|css|scss|less|vue|svelte)$'
GEN_RE='(lock\.yaml|\.lock$|package-lock\.json|generated|\.words\.json|\.snap$|\.min\.(js|css)$)'
BIN_RE='\.(ttf|woff2?|otf|eot|m4a|mp3|wav|ogg|webm|jpg|jpeg|png|gif|webp|avif|svg|ico|icns|pdf|zip|gz|tgz|mp4|mov|bin|wasm|dat)$'

tracked() { git ls-files 2>/dev/null; }

# One pass: classify every tracked file once and write the lists to temp files.
# The earlier version re-walked the tree per bucket and took 4 minutes.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

tracked | grep -Ei "$SRC_RE" | grep -Evi "$GEN_RE" | grep -vE '\.(test|spec)\.[a-z]+$' | grep -vE '\.d\.ts$' > "$WORK/src"
tracked | grep -Ei "$SRC_RE" | grep -Evi "$GEN_RE" | grep -E '\.(test|spec)\.[a-z]+$' > "$WORK/tests"
tracked | grep -Ei "$GEN_RE" > "$WORK/gen"
tracked | grep -Ei "$BIN_RE" > "$WORK/bin"
tracked | grep -Ei "$SRC_RE" | grep -Evi "$GEN_RE" > "$WORK/src_all"

count_lines() {
  # One wc over the whole list rather than one wc per file: 1,400 forks took
  # 40 seconds on their own.
  local list="$1"
  [ -s "$list" ] || { echo 0; return; }
  # xargs -0 so paths with spaces survive; tail -1 is the total.
  local out
  out=$(tr '\n' '\0' < "$list" | xargs -0 wc -l 2>/dev/null | tail -1 | awk '{print $1}')
  case "$out" in ''|*[!0-9]*) out=0 ;; esac
  echo "$out"
}

# The same total, per file, in one pass: prints "lines path" for each file.
lines_each() {
  local list="$1"
  [ -s "$list" ] || return 0
  tr '\n' '\0' < "$list" | xargs -0 wc -l 2>/dev/null \
    | grep -v ' total$' | grep -v '^$' | awk '{print $1, $2}'
}

count_bytes() {
  local list="$1" total=0 n
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    n=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
    [ -n "$n" ] && total=$((total + n))
  done < "$list"
  echo "$total"
}

echo "=== Repo shape ==="
echo "tracked files: $(tracked | wc -l | tr -d ' ')"

src_lines=$(count_lines "$WORK/src")
src_count=$(wc -l < "$WORK/src" | tr -d ' ')
test_lines=$(count_lines "$WORK/tests")
test_count=$(wc -l < "$WORK/tests" | tr -d ' ')
gen_lines=$(count_lines "$WORK/gen")
gen_count=$(wc -l < "$WORK/gen" | tr -d ' ')
bin_bytes=$(count_bytes "$WORK/bin")
bin_count=$(wc -l < "$WORK/bin" | tr -d ' ')

echo ""
echo "=== Lines by kind ==="
printf 'source (no tests) : %9s lines  %5s files\n' "$src_lines" "$src_count"
printf 'tests              : %9s lines  %5s files\n' "$test_lines" "$test_count"
printf 'generated          : %9s lines  %5s files\n' "$gen_lines" "$gen_count"
printf 'binary             : %9s bytes  %5s files\n' "$bin_bytes" "$bin_count"
if [ "$src_lines" -gt 0 ]; then
  printf 'test-to-source     : %9s (1 per %s source lines)\n' \
    "$(awk -v t="$test_lines" -v s="$src_lines" 'BEGIN{printf "%.2f", t/s}')" \
    "$(( src_lines / (test_lines > 0 ? test_lines : 1) ))"
fi

echo ""
echo "=== Source lines by directory ==="
cut -d/ -f1 "$WORK/src" | sort | uniq -c | sort -rn | while read -r c dir; do
  grep "^${dir}/" "$WORK/src" > "$WORK/.dirlist" 2>/dev/null || continue
  l=$(count_lines "$WORK/.dirlist")
  printf '%-12s %9s lines  %5s files\n' "$dir/" "$l" "$c"
done

echo ""
echo "=== Size distribution (source only) ==="
lines_each "$WORK/src" | awk '{
  if ($1<=50) a++; else if ($1<=150) b++; else if ($1<=300) c++;
  else if ($1<=500) d++; else if ($1<=1000) e++; else f++;
} END {
  printf "<=50      %5d\n51-150    %5d\n151-300   %5d\n301-500   %5d\n501-1000  %5d\n1001+     %5d\n", a,b,c,d,e,f
}'

echo ""
echo "=== Longest source files ==="
lines_each "$WORK/src" | sort -rn | head -20

echo ""
echo "=== Longest test files ==="
lines_each "$WORK/tests" | sort -rn | head -10

echo ""
echo "=== Test adjacency ==="
# How many source files have a test sitting beside them.
untested=0; tested=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  base="${f%.*}"; ext="${f##*.}"
  if [ -f "$base.test.$ext" ] || [ -f "$base.spec.$ext" ]; then
    tested=$((tested + 1))
  else
    untested=$((untested + 1))
  fi
done < "$WORK/src"
echo "source files     : $src_count"
echo "  tested beside  : $tested"
echo "  untested       : $untested"
if [ "$src_count" -gt 0 ]; then
  echo "  tested share   : $(( tested * 100 / src_count ))%"
fi

echo ""
echo "=== Escape hatches in source ==="
# The same shapes scout-facts.sh counts, but across the whole repo.
# One grep over the whole list per pattern, not one grep per file per pattern:
# that was 7,000 forks and took 30 seconds on its own.
h_any=$(grep -hoE '\bas\s+any\b|:\s*any\b|<any>' $(cat "$WORK/src") 2>/dev/null | wc -l | tr -d ' ')
h_ts=$(grep -hoE '@ts-(ignore|nocheck|expect-error)' $(cat "$WORK/src") 2>/dev/null | wc -l | tr -d ' ')
h_es=$(grep -hoE 'eslint-disable' $(cat "$WORK/src") 2>/dev/null | wc -l | tr -d ' ')
h_nn=$(grep -hoE '[A-Za-z0-9_\)\]]!\.' $(cat "$WORK/src") 2>/dev/null | wc -l | tr -d ' ')
h_cast=$(grep -hoE '\bas\s+[A-Z][A-Za-z]+' $(cat "$WORK/src") 2>/dev/null | wc -l | tr -d ' ')
total=$((h_any + h_ts + h_es + h_nn + h_cast))
echo "as any          : $h_any"
echo "@ts-ignore      : $h_ts"
echo "eslint-disable  : $h_es"
echo "non-null !      : $h_nn"
echo "as <Type> casts : $h_cast"
echo "total           : $total"
if [ "$src_lines" -gt 0 ] && [ "$total" -gt 0 ]; then
  echo "density         : one per $(( src_lines / total )) source lines"
fi

echo ""
echo "=== Coupling and import graph ==="
# The graph is built in Node, once. The shell version of this was O(files^2)
# greps and took ten minutes on a 1,400-file repo.
COUPLING="$(cd "$(dirname "$0")" && pwd)/coupling.mjs"
if command -v node >/dev/null 2>&1 && [ -f "$COUPLING" ]; then
  node "$COUPLING" "$PWD" 2>&1
else
  echo "(node not found — skipping the import graph)"
fi

echo ""
echo "=== measure: $(( $(date +%s) - start ))s ==="
