#!/bin/sh
# Copies the built plugin into a vault: scripts/install-to-vault.sh "/path/to/Test Vault"
set -e
VAULT="$1"
if [ -z "$VAULT" ] || [ ! -d "$VAULT/.obsidian" ]; then
  echo "Usage: $0 /path/to/vault   (the folder must contain .obsidian — open it in Obsidian once first)"
  exit 1
fi
DEST="$VAULT/.obsidian/plugins/daybook"
mkdir -p "$DEST"
cd "$(dirname "$0")/.."
cp main.js manifest.json styles.css "$DEST/"
echo "Installed Daybook into $DEST"
