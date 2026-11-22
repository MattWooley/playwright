#!/usr/bin/env bash
# [helium patch] Build the extension and sync it into the folder that Helium loads unpacked. See HELIUM.md.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
target="${HELIUM_EXTENSION_DIR:-$HOME/Dev/extensions/playwright-extension-helium}"
deps="${HELIUM_BUILD_DEPS:-$HOME/.cache/helium-ext-build}"

cd "$here"
if [[ ! -e node_modules ]]; then
  # Build deps live outside the repo, so a rebase never touches them. Versions follow the root package.json.
  root="$here/../.."
  pkgs=()
  for p in vite @vitejs/plugin-react vite-plugin-static-copy react react-dom typescript @types/chrome @types/react @types/react-dom; do
    pkgs+=("$p@$(node -p "require('$root/package.json').devDependencies['$p']")")
  done
  mkdir -p "$deps"
  [[ -f "$deps/package.json" ]] || echo '{"name":"helium-ext-build","private":true}' > "$deps/package.json"
  (cd "$deps" && npm install --no-audit --no-fund --silent "${pkgs[@]}")
  ln -sfn "$deps/node_modules" node_modules
fi

./node_modules/.bin/tsc -p tsconfig.json --noEmit
./node_modules/.bin/tsc -p tsconfig.ui.json --noEmit
rm -rf dist
./node_modules/.bin/vite build >/dev/null

mkdir -p "$target"
rsync -a --delete --exclude README.md dist/ "$target/"
cat > "$target/README.md" <<EOF
# playwright-extension-helium

Built output of the \`helium\` branch in \`$here\`. Don't edit files here: run
\`packages/extension/helium-deploy.sh\` there, which overwrites this folder. Notes are in \`HELIUM.md\` on that branch.

Built $(date -Iseconds) from $(git -C "$here" rev-parse --short HEAD) ($(git -C "$here" describe --always --dirty)).
EOF
echo "DEPLOYED $(node -p "require('$target/manifest.json').version") to $target. Reload it in chrome://extensions or from its page."
