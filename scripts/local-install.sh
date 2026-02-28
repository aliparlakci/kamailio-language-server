#!/bin/bash
set -e

echo "=== Building and installing extension locally ==="

# Step 1: Bundle
echo "1. Bundling..."
npm run bundle 2>&1 | grep -E '(Done|error)'

# Step 2: Ensure WASM
echo "2. Copying WASM..."
npm run copy-wasm 2>/dev/null

# Step 3: Build VSIX manually (it's just a ZIP with specific structure)
echo "3. Packaging VSIX..."
VSIX_DIR=$(mktemp -d)
EXTENSION_DIR="$VSIX_DIR/extension"
mkdir -p "$EXTENSION_DIR/client/out"
mkdir -p "$EXTENSION_DIR/server/out"
mkdir -p "$EXTENSION_DIR/server/wasm"

# Copy required files
cp package.json "$EXTENSION_DIR/"
cp client/out/extension.js "$EXTENSION_DIR/client/out/"
cp client/package.json "$EXTENSION_DIR/client/"
cp server/out/server.js "$EXTENSION_DIR/server/out/"
cp server/out/tree-sitter.wasm "$EXTENSION_DIR/server/out/"
cp server/package.json "$EXTENSION_DIR/server/"
cp server/wasm/tree-sitter-python.wasm "$EXTENSION_DIR/server/wasm/"

# Create [Content_Types].xml (required by VSIX format)
cat > "$VSIX_DIR/[Content_Types].xml" << 'XMLEOF'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".wasm" ContentType="application/wasm"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
XMLEOF

# Create extension.vsixmanifest
PUBLISHER=$(node -e "console.log(require('./package.json').publisher)")
NAME=$(node -e "console.log(require('./package.json').name)")
DISPLAY_NAME=$(node -e "console.log(require('./package.json').displayName)")
VERSION=$(node -e "console.log(require('./package.json').version)")
DESCRIPTION=$(node -e "console.log(require('./package.json').description)")

cat > "$VSIX_DIR/extension.vsixmanifest" << XMLEOF
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${NAME}" Version="${VERSION}" Publisher="${PUBLISHER}"/>
    <DisplayName>${DISPLAY_NAME}</DisplayName>
    <Description>${DESCRIPTION}</Description>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
XMLEOF

# Create ZIP
VSIX_PATH="$(pwd)/test-local.vsix"
(cd "$VSIX_DIR" && zip -r "$VSIX_PATH" . -x '*.DS_Store') > /dev/null 2>&1

rm -rf "$VSIX_DIR"
echo "   Created: $VSIX_PATH ($(wc -c < "$VSIX_PATH" | tr -d ' ') bytes)"

# Step 4: Verify VSIX contents
echo "4. Verifying VSIX contents..."
CONTENTS=$(unzip -l "$VSIX_PATH" 2>/dev/null)
for required in "extension/client/out/extension.js" "extension/server/out/server.js" "extension/server/wasm/tree-sitter-python.wasm" "extension/package.json"; do
  if echo "$CONTENTS" | grep -q "$required"; then
    echo "   OK: $required"
  else
    echo "   FAIL: $required missing!"
    exit 1
  fi
done

# Step 5: Install in VS Code
echo "5. Installing in VS Code..."
code --install-extension "$VSIX_PATH" --force 2>&1

echo ""
echo "=== Done! Restart VS Code and open a .py file to test. ==="
echo "   To uninstall: code --uninstall-extension ${PUBLISHER}.${NAME}"

# Cleanup
rm -f "$VSIX_PATH"
