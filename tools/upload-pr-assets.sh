#!/usr/bin/env bash
# Commits pictures for a pull request description to the pr-assets branch,
# then prints Markdown that embeds each one by commit SHA.
#
# Usage: tools/upload-pr-assets.sh [-d folder] file...
# The folder on pr-assets defaults to the name of the current branch.
set -euo pipefail

branch=pr-assets
usage="Usage: $0 [-d folder] file..."
folder="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${1:-}" == -d ]]; then
  folder="${2:?$usage}"
  shift 2
fi
if (($# == 0)); then
  echo "$usage" >&2
  exit 2
fi
if [[ "$folder" == HEAD ]]; then
  echo "Detached HEAD: give a folder with -d." >&2
  exit 2
fi
if [[ -n "$(printf '%s\n' "${@##*/}" | sort | uniq -d)" ]]; then
  echo "Two files have the same name." >&2
  exit 2
fi
repo="$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"

# A separate index adds the files without a checkout of pr-assets.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"

parent=()
found=0
git ls-remote -q --exit-code origin "refs/heads/$branch" >/dev/null || found=$?
if ((found == 0)); then
  git fetch -q origin "$branch"
  parent=(-p FETCH_HEAD)
  git read-tree FETCH_HEAD
elif ((found != 2)); then  # 2: the branch does not exist yet.
  exit "$found"
fi
for file in "$@"; do
  blob="$(git hash-object -w -- "$file")"
  git update-index --add --cacheinfo "100644,$blob,$folder/$(basename "$file")"
done
commit="$(git commit-tree "$(git write-tree)" ${parent[@]+"${parent[@]}"} \
  -m "Add pictures for $folder")"
git push -q origin "$commit:refs/heads/$branch"

for file in "$@"; do
  name="$(basename "$file")"
  echo "![${name%.*}](https://github.com/$repo/blob/$commit/$folder/$name?raw=true)"
done
