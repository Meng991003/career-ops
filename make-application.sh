#!/usr/bin/env bash
# Build one job's application pack into output/<report>-<slug>/.
#   ./make-application.sh <report-num> <slug> <tailor-spec> <cover-payload>
# Both generators refuse paths outside output/, and the cover generator only
# mkdirs output/ itself, so the per-job dir is created here first.
set -euo pipefail
cd "$(dirname "$0")"

num="$1"; slug="$2"; spec="$3"; payload="$4"
dir="output/${num}-${slug}"
mkdir -p "$dir"

node build-cv.mjs "$spec" --out "$dir/cv.html" >/dev/null
node generate-pdf.mjs "$dir/cv.html" "$dir/cv.pdf" --format=a4 2>&1 \
  | grep -E "✅|📊 Pages|Refusing|Error" | sed "s/^/  cv:    /"

# Force the payload's output into this job's folder so a stale output_path in
# the JSON can't scatter PDFs back into output/ root.
python3 - "$payload" "$dir/cover.pdf" "$dir/cover-payload.json" <<'PY'
import json, sys
src, out, dst = sys.argv[1], sys.argv[2], sys.argv[3]
d = json.load(open(src))
d["output_path"] = out
json.dump(d, open(dst, "w"), indent=2, ensure_ascii=False)
PY
node generate-cover-letter.mjs --payload "$dir/cover-payload.json" 2>&1 \
  | grep -E "✅|📊 Pages|Refusing|Error" | sed "s/^/  cover: /"

echo "  → $dir"
