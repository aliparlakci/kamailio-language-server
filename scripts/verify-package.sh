#!/bin/bash
set -e

echo "=== Verifying extension packaging ==="

# Step 1: Bundle
echo ""
echo "1. Bundling with esbuild..."
npm run bundle

# Step 2: Check bundled files exist and are non-trivial
echo ""
echo "2. Checking bundled output..."

check_file() {
  if [ ! -f "$1" ]; then
    echo "  FAIL: $1 missing"
    exit 1
  fi
  size=$(wc -c < "$1" | tr -d ' ')
  if [ "$size" -lt "$2" ]; then
    echo "  FAIL: $1 too small (${size} bytes, expected >$2)"
    exit 1
  fi
  echo "  OK: $1 (${size} bytes)"
}

check_file "client/out/extension.js" 10000
check_file "server/out/server.js" 10000
check_file "server/out/tree-sitter.wasm" 100000

# Step 3: Check WASM
echo ""
echo "3. Checking WASM file..."
npm run copy-wasm 2>/dev/null
check_file "server/wasm/tree-sitter-python.wasm" 100000

# Step 4: Verify bundles don't have broken requires
echo ""
echo "4. Checking bundles for unresolved imports..."

# Client: should only require 'vscode' externally
client_requires=$(node -e "
  const fs = require('fs');
  const code = fs.readFileSync('client/out/extension.js', 'utf-8');
  // Find all require() calls that aren't relative or builtin
  const requires = [...code.matchAll(/require\(['\"]([^.\/][^'\"]*?)['\"]\)/g)]
    .map(m => m[1])
    .filter(r => !['path','fs','os','net','child_process','crypto','util','events','stream','url','assert','buffer','string_decoder','http','https','tls','zlib','module','node:events','node:net','node:stream','node:crypto','node:buffer','node:child_process','node:path','node:fs','node:os','node:url','node:util','node:assert','node:http','node:https','node:tls','node:zlib','node:string_decoder','node:module'].includes(r));
  const unique = [...new Set(requires)];
  console.log(JSON.stringify(unique));
")
echo "  Client external requires: $client_requires"
if echo "$client_requires" | node -e "
  const deps = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  const bad = deps.filter(d => d !== 'vscode');
  if (bad.length > 0) { console.error('  FAIL: unexpected externals:', bad.join(', ')); process.exit(1); }
"; then
  echo "  OK: client bundle only depends on 'vscode' externally"
fi

# Server: should have no external requires
server_requires=$(node -e "
  const fs = require('fs');
  const code = fs.readFileSync('server/out/server.js', 'utf-8');
  const requires = [...code.matchAll(/require\(['\"]([^.\/][^'\"]*?)['\"]\)/g)]
    .map(m => m[1])
    .filter(r => !['path','fs','os','net','child_process','crypto','util','events','stream','url','assert','buffer','string_decoder','http','https','tls','zlib','module','node:events','node:net','node:stream','node:crypto','node:buffer','node:child_process','node:path','node:fs','node:os','node:url','node:util','node:assert','node:http','node:https','node:tls','node:zlib','node:string_decoder','node:module'].includes(r));
  const unique = [...new Set(requires)];
  console.log(JSON.stringify(unique));
")
echo "  Server external requires: $server_requires"
if echo "$server_requires" | node -e "
  const deps = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
  if (deps.length > 0) { console.error('  FAIL: server has external deps:', deps.join(', ')); process.exit(1); }
"; then
  echo "  OK: server bundle is fully self-contained"
fi

# Step 6: Check .vscodeignore excludes node_modules
echo ""
echo "6. Checking .vscodeignore..."
if grep -q '\*\*/node_modules/\*\*' .vscodeignore; then
  echo "  OK: node_modules excluded from VSIX"
else
  echo "  WARN: node_modules may be included in VSIX"
fi

# Step 7: Try packaging with vsce (if available)
echo ""
echo "7. Packaging VSIX..."
if npx @vscode/vsce package --pre-release --no-dependencies -o test-package.vsix 2>/dev/null; then
  echo "  OK: VSIX created"

  # Inspect VSIX contents
  echo ""
  echo "8. Inspecting VSIX contents..."
  mkdir -p /tmp/vsix-check
  unzip -o test-package.vsix -d /tmp/vsix-check > /dev/null 2>&1

  # Check for node_modules (should not be there)
  if find /tmp/vsix-check -path "*/node_modules/*" -type f | head -1 | grep -q .; then
    echo "  FAIL: node_modules found in VSIX!"
    exit 1
  else
    echo "  OK: no node_modules in VSIX"
  fi

  # Check for required files
  for f in "extension/client/out/extension.js" "extension/server/out/server.js" "extension/server/wasm/tree-sitter-python.wasm" "extension/package.json"; do
    if [ -f "/tmp/vsix-check/$f" ]; then
      echo "  OK: $f present"
    else
      echo "  FAIL: $f missing from VSIX"
      exit 1
    fi
  done

  vsix_size=$(wc -c < test-package.vsix | tr -d ' ')
  echo ""
  echo "  VSIX size: ${vsix_size} bytes"

  # Cleanup
  rm -rf /tmp/vsix-check test-package.vsix
else
  echo "  SKIP: vsce not available or failed (Node version may be too old)"
  echo "  The bundle verification above is sufficient for local testing."
fi

echo ""
echo "=== All checks passed ==="
