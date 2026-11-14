#!/bin/bash
# claude-bot's own setup (no root). Idempotent. Run as:
#   sudo -u claude-bot -H bash install-user.sh <setup-dir>
set -euo pipefail
SETUP="${1:?setup dir}"
cd "$HOME"
mkdir -p .local/bin .ssh .claude && chmod 700 .ssh

# Deploy key (read/write) for github.com/cratonoid/handpikd_revmap.
[ -f .ssh/handpikd_deploy ] || ssh-keygen -q -t ed25519 -N "" -C "claude-bot@handpikd-vps" -f .ssh/handpikd_deploy
cat > .ssh/config <<'CFG'
Host github.com
  IdentityFile ~/.ssh/handpikd_deploy
  IdentitiesOnly yes
CFG
chmod 600 .ssh/config
grep -q github.com .ssh/known_hosts 2>/dev/null || ssh-keyscan -t ed25519 github.com >> .ssh/known_hosts 2>/dev/null

git config --global user.name "claude-bot"
git config --global user.email "claude-bot@handpikd-vps"
git config --global pull.ff only

# The repo is public, so clone over https now. Pushes go over SSH with the deploy key.
[ -d handpikd_revmap/.git ] || git clone -q https://github.com/cratonoid/handpikd_revmap.git
git -C handpikd_revmap remote set-url --push origin git@github.com:cratonoid/handpikd_revmap.git

# Toolchain, all under $HOME.
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.local/node/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
if ! command -v node >/dev/null; then   # Node 22 LTS (frontend image uses 20; Next 16 needs >=20.9)
  v="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -1)"
  curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$v"
  curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep " $v\$" | sha256sum -c -
  rm -rf .local/node && mkdir -p .local/node && tar -xJf "$v" -C .local/node --strip-components=1 && rm "$v"
fi
if ! command -v bun >/dev/null; then    # no unzip on this box, so extract with python
  curl -fsSL -o /tmp/bun-$$.zip https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip
  mkdir -p .bun/bin && python3 -m zipfile -e /tmp/bun-$$.zip /tmp/bun-$$ && mv /tmp/bun-$$/bun-linux-x64/bun .bun/bin/bun && chmod 755 .bun/bin/bun && rm -rf /tmp/bun-$$ /tmp/bun-$$.zip
fi
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash >/dev/null

grep -q 'handpikd PATH' .bashrc || cat >> .bashrc <<'RC'
# handpikd PATH
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.local/node/bin:$PATH"
RC
install -m 644 "$SETUP/CLAUDE.md" .claude/CLAUDE.md

echo "versions: node $(node -v), bun $(bun -v), uv $(uv --version | cut -d' ' -f2), claude $(claude --version 2>/dev/null | head -1)"
echo "PUBLIC DEPLOY KEY:"; cat .ssh/handpikd_deploy.pub
