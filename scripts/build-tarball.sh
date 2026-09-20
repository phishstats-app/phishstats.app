#!/usr/bin/env bash
# Builds the deployable tarball from a commit: the checked-out tree at HEAD
# (never the working tree), with every /assets/*.css and *.js reference in
# the templates stamped ?v=<hash of those assets> so browsers refetch a
# changed stylesheet on the next page load, and a build.json at the root that
# the server shows in its footer and at /api/version.
#
#   bash scripts/build-tarball.sh <repo dir> <output dir>
#
# Prints commit=<short sha>, assets=<stamp>, bytes=<size> and writes
# <output dir>/app.tgz. CI runs this and signs the result; it runs the same
# way on a laptop.
set -euo pipefail
src=${1:?repo dir}
out=${2:?output dir}
# Under Git Bash a Windows path like C:\x makes tar look for a host named C.
if command -v cygpath >/dev/null 2>&1; then src=$(cygpath -u "$src"); out=$(cygpath -u "$out"); fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

commit=$(git -C "$src" rev-parse --short HEAD)
# Export the committed bytes as they are in the index (LF): a Windows git with
# core.autocrlf=true would otherwise convert on the way out and the same
# commit would build a different tarball, and a different stamp, than CI.
git -C "$src" -c core.autocrlf=false -c core.eol=lf archive --format=tar HEAD | tar -x -C "$work"
rm -rf "$work/.github" "$work/deploy"

# The stamp: SHA-256 over the concatenated upper-case SHA-256 hex digests of
# assets/*.css and *.js in name order, first 8 hex characters, lower-case.
# The same numbers the previous deploy tool produced, so a build from the
# same assets gets the same stamp and browsers keep their caches.
stamp=""
mapfile -t assets < <(cd "$work/assets" 2>/dev/null && ls -1 *.css *.js 2>/dev/null | LC_ALL=C sort)
if [ "${#assets[@]}" -gt 0 ]; then
  joined=""
  for f in "${assets[@]}"; do
    joined+=$(sha256sum "$work/assets/$f" | cut -c1-64 | tr 'a-f' 'A-F')
  done
  stamp=$(printf '%s' "$joined" | sha256sum | cut -c1-8)
else
  stamp=$(date -u +%Y%m%d%H%M)
fi
find "$work/templates" -name '*.html' -exec sed -i -E \
  's#(/assets/[a-z0-9-]+\.(css|js))(\?v=[A-Za-z0-9]+)?"#\1?v='"$stamp"'"#g' {} +

printf '{"commit":"%s","dirty":false,"deployedAt":"%s","assets":"%s"}\n' \
  "$commit" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$stamp" > "$work/build.json"

mkdir -p "$out"
tar -czf "$out/app.tgz" -C "$work" .
echo "commit=$commit"
echo "assets=$stamp"
echo "bytes=$(stat -c %s "$out/app.tgz" 2>/dev/null || stat -f %z "$out/app.tgz")"
