#!/bin/sh
set -eu

if [ -f package.json ]; then
	bun ci
fi

# Install Claude Code if missing; /home/vscode is a named volume, so it persists
if [ ! -x "$HOME/.claude/local/claude" ]; then
	curl -fsSL https://claude.ai/install.sh | bash
fi

grep -q '.claude/local' "$HOME/.bashrc" 2>/dev/null || \
	echo 'export PATH="$HOME/.claude/local:$PATH"' >> "$HOME/.bashrc"

# Skip onboarding wizard; secrets come from remoteEnv, not this file
mkdir -p "$HOME/.claude"
if [ ! -f "$HOME/.claude/settings.json" ]; then
	cat > "$HOME/.claude/settings.json" << 'EOF'
{
	"hasCompletedOnboarding": true
}
EOF
fi
