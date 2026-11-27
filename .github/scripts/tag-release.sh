#!/usr/bin/env bash
# Tags a release's images and its commit (specs/032 T036): every image
# publish-images.yml publishes, from its `:<commit>` tag to `:Release<NN>`, and
# then the commit itself with the git tag `Release<NN>`. Run by
# .github/workflows/tag-release.yml, and by tools/workflows.spec.ts against a
# stand-in registry and a throwaway repository.
#
# A release's tag is written once and never moves: production runs
# `IMAGE_TAG=Release<NN>`, and rolling back is the previous release's tag
# (deploy/release-server/README.md §9). So, before anything is written:
#   - the commit must be on main, and its docker-compose.yml must name release
#     NN's graph, as the production checkout at that tag will;
#   - every image must have the commit's tag in the registry;
#   - `Release<NN>` on an image must be absent or already the commit's digest,
#     and the git tag absent or already on the commit.
# Anything else is refused, and nothing is written.
#
# A run stopped part-way (a registry error after some images were tagged) is
# finished by running it again with the same commit and release: an image whose
# `Release<NN>` already names the commit tag's digest is taken as done, since
# that is exactly what this run would have written; at any other digest the
# run refuses. The git tag the same: on the commit, done; anywhere else, refused.
# It is pushed only after every image is tagged and checked, so a git tag
# `Release<NN>` means the release's images are all there. A run that finds
# everything done writes nothing and succeeds.
#
# Nothing here forces, moves or deletes a tag: the images' tags are created
# only where absent, and `git push` without force refuses to replace a tag.
# Not airtight against another writer between a check and its copy (the
# workflow runs one at a time, and the registry role is CI's alone): the
# digest check after each copy fails the run if the tag names anything else.
#
# Reads from the environment: COMMIT and RELEASE (the dispatch's inputs, never
# trusted), REGISTRY, IMAGES (publish-images.yml's images, space-separated;
# tools/workflows.spec.ts holds the two lists equal) and GITHUB_REF. Runs at
# the top of a full clone whose `origin` is this repository, signed in to the
# registry, with a token allowed to push tags.
set -euo pipefail
# A failure inside $( … ) fails the script too, not only the substitution.
shopt -s inherit_errexit

refuse() {
  echo "refused: $*" >&2
  exit 1
}

# The inputs as the workflow's first step checks them, again here: whatever
# runs this must not reach the registry with anything else. Never echoed back.
[[ "${COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] || refuse "the commit is not a full 40-character commit id"
[[ "${RELEASE:-}" =~ ^[1-9][0-9]{0,3}$ ]] || refuse "the release is not a release number (99, say)"
[ "${GITHUB_REF:-}" = refs/heads/main ] || refuse "not run from main"
[ -n "${REGISTRY:-}" ] || refuse "no registry named"
read -r -a images <<< "${IMAGES:-}"
[ "${#images[@]}" -gt 0 ] || refuse "no images named"
TAG="Release$RELEASE"

# The commit: in this repository, on main's history, and naming this release's
# graph (the checkout production runs at this tag uses its compose file).
git cat-file -e "$COMMIT^{commit}" 2> /dev/null || refuse "$COMMIT is not a commit here"
if ! git merge-base --is-ancestor "$COMMIT" origin/main; then
  refuse "$COMMIT is not on main"
fi
compose=$(git show "$COMMIT:docker-compose.yml") || refuse "$COMMIT has no docker-compose.yml"
if ! grep -qE "^ +image: reactome/graphdb_readonly:$TAG\$" <<< "$compose"; then
  refuse "$COMMIT's docker-compose.yml does not name release $RELEASE's graph"
fi

# 0: the tag is there; 1: the registry says it is not. Only that
# answer means absent: the CLI exits 254 for any error the service
# returns and names it in its message. Any other failure stops here,
# so a registry that cannot answer never reads as "build it".
published() {
  local err status=0
  err=$(aws ecr-public describe-images --region us-east-1 \
    --repository-name "$1" --image-ids imageTag="$2" 2>&1 > /dev/null) || status=$?
  if [ "$status" -eq 0 ]; then return 0; fi
  if [ "$status" -eq 254 ] &&
    [[ "$err" == *"(ImageNotFoundException) when calling the DescribeImages operation"* ]]; then
    return 1
  fi
  echo "$1:$2: the registry did not answer (exit $status): $err" >&2
  exit 1
}
# The digest a tag names: a single manifest's or an index's own.
digest_of() {
  docker buildx imagetools inspect "$1" --format '{{json .Manifest}}' | jq -r .digest
}

# Sets released to yes if image $1's `Release<NN>` already names the commit
# tag's digest, to no if it is absent; refuses if it names anything else.
# Called as a statement, never as a condition, so `set -e` holds inside it.
declare -A want=()
check_released() {
  local name="$1" have
  released=no
  if ! published "$name" "$TAG"; then return; fi
  have=$(digest_of "$REGISTRY/$name:$TAG")
  if [ "$have" != "${want[$name]}" ]; then
    refuse "$name:$TAG already names $have, not $COMMIT's ${want[$name]}: a release's tag never moves"
  fi
  released=yes
}

# Sets tagged to the commit the git tag names on GitHub (through an annotated
# tag), or to nothing if there is none. A failed lookup fails the script. The
# peeled line is listed only when asked for by name.
check_tagged() {
  local refs
  refs=$(git ls-remote --tags origin "refs/tags/$TAG" "refs/tags/$TAG^{}")
  tagged=$(awk -v ref="refs/tags/$TAG" \
    '$2 == ref { direct = $1 } $2 == ref "^{}" { peeled = $1 }
     END { print (peeled != "" ? peeled : direct) }' <<< "$refs")
}

# Everything decided before anything is written.
check_tagged
if [ -n "$tagged" ] && [ "$tagged" != "$COMMIT" ]; then
  refuse "the git tag $TAG already names $tagged, not $COMMIT: a release's tag never moves"
fi
copying=()
for name in "${images[@]}"; do
  if ! published "$name" "$COMMIT"; then
    refuse "$name:$COMMIT is not in the registry: nothing tagged"
  fi
  digest=$(digest_of "$REGISTRY/$name:$COMMIT")
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || refuse "$name:$COMMIT has no digest: $digest"
  want[$name]=$digest
  check_released "$name"
  if [ "$released" = yes ]; then
    echo "$name: $TAG names $digest already"
  else
    copying+=("$name")
  fi
done

# Copied on the registry from the commit's tag, by digest: nothing pulled,
# rebuilt or pushed. (`--prefer-index=false`: by default a single manifest
# would be wrapped in a new index, under another digest.) Each image checked
# again just before its own copy, and its digest after it.
for name in "${copying[@]}"; do
  check_released "$name"
  if [ "$released" = yes ]; then continue; fi
  docker buildx imagetools create --prefer-index=false \
    --tag "$REGISTRY/$name:$TAG" "$REGISTRY/$name:$COMMIT"
  got=$(digest_of "$REGISTRY/$name:$TAG")
  if [ "$got" != "${want[$name]}" ]; then
    echo "$name: $TAG names $got, not $COMMIT's ${want[$name]}" >&2
    exit 1
  fi
  echo "$name: $TAG -> $got"
done

# Every image once more, as the release will be pulled, before the git tag.
for name in "${images[@]}"; do
  check_released "$name"
  [ "$released" = yes ] || refuse "$name:$TAG is not there after tagging"
done

if [ "$tagged" = "$COMMIT" ]; then
  echo "the git tag $TAG names $COMMIT already"
  exit 0
fi
git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  tag -a "$TAG" -m "Reactome release $RELEASE" "$COMMIT"
git push origin "refs/tags/$TAG"
check_tagged
[ "$tagged" = "$COMMIT" ] || refuse "the git tag $TAG names ${tagged:-nothing} after the push, not $COMMIT"
echo "the git tag $TAG -> $COMMIT"
