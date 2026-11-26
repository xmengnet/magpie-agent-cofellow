#!/usr/bin/env bash
# End-to-end check in a throwaway HOME: installs the plugin into a sandboxed
# magpie, wires CoFellow to a magpie model, then takes it out. The real
# ~/.config/magpie and ~/.cofellow are never touched.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sb="$(mktemp -d)"
trap 'rm -rf "$sb"' EXIT

export HOME="$sb"
export XDG_CONFIG_HOME="$sb/.config"
export XDG_CACHE_HOME="$sb/.cache"
export MAGPIE_ADDR="127.0.0.1:3499"

mkdir -p "$HOME/.cofellow" "$HOME/bin"
# magpie detects the agent by its bin (or dir); a stub is enough here.
printf '#!/bin/sh\nexit 0\n' > "$HOME/bin/cofellow"
chmod +x "$HOME/bin/cofellow"
export PATH="$HOME/bin:$PATH"

cat > "$HOME/.cofellow/config.json" <<'JSON'
{
  "model": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "old",
    "modelName": "deepseek-v4-flash",
    "providerId": "deepseek"
  },
  "provider": {
    "deepseek": {
      "name": "DeepSeek",
      "protocol": "openai",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "old",
      "enabled": true,
      "models": {
        "deepseek-v4-flash": { "name": "DeepSeek Flash", "contextWindow": 128000, "enabled": true }
      }
    }
  },
  "selection": { "providerId": "deepseek", "modelId": "deepseek-v4-flash" }
}
JSON

# A provider so magpie has a model name to wire (the key is never used here).
magpie provider add deepseek test </dev/null >/dev/null 2>&1 || true
magpie plugin add "$here" </dev/null

echo "--- magpie ls ---"
magpie ls | grep -i cofellow || true

echo "--- wire ---"
magpie cofellow deepseek/deepseek-v4-flash

echo "--- ~/.cofellow/config.json (wired) ---"
cat "$HOME/.cofellow/config.json"

python3 - "$HOME/.cofellow/config.json" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
assert "magpie" in cfg["provider"], "provider.magpie missing"
assert "deepseek" in cfg["provider"], "user provider was replaced"
assert cfg["selection"]["providerId"] == "magpie", cfg["selection"]
assert cfg["selection"]["modelId"] == "deepseek/deepseek-v4-flash", cfg["selection"]
assert cfg["model"]["providerId"] == "magpie", cfg["model"]
print("wired: provider.magpie + selection + model OK")
PY

echo "--- unwire ---"
magpie cofellow default

python3 - "$HOME/.cofellow/config.json" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
assert "magpie" not in cfg["provider"], "provider.magpie was not removed"
assert cfg["provider"]["deepseek"]["apiKey"] == "old", "user provider was not restored"
assert cfg["selection"] == {"providerId": "deepseek", "modelId": "deepseek-v4-flash"}, cfg["selection"]
model = cfg["model"]
assert model["modelName"] == "deepseek-v4-flash", model
assert model["providerId"] == "deepseek", model
assert model["apiKey"] == "old", model
assert model["baseUrl"] == "https://api.deepseek.com/v1", model
for leftover in ("contextWindow", "maxOutputTokens", "maxTokens", "reasoningLevels", "reasoningLevel", "protocol"):
    assert leftover not in model, f"agent field {leftover} was not removed: {model}"
print("unwired: original provider / selection / model restored, no agent leftovers")
PY

echo "OK"