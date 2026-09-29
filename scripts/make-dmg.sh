#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./package.json').version")
app_path="release/Cairn-darwin-arm64/Cairn.app"
output="release/Cairn-${version}-macOS-arm64.dmg"
[[ -d "$app_path" ]] || { echo '先运行 npm run package'; exit 1; }
[[ ! -e "$output" ]] || { echo "已存在：$output，请先移动旧文件再打包。"; exit 1; }
staging=$(mktemp -d "${TMPDIR:-/tmp}/cairn-dmg.XXXXXX")
trap 'rm -rf "$staging"' EXIT
ditto "$app_path" "$staging/Cairn.app"
codesign --verify --deep --strict "$staging/Cairn.app"
ln -s /Applications "$staging/Applications"
printf '%s\n' 'Cairn 安装说明' '' '将 Cairn.app 拖入 Applications（应用程序）即可安装。' '适用于 Apple Silicon Mac（M 系列芯片）。' '' '此预览版尚未通过 Apple Developer ID 签名和公证。' '如果 macOS 阻止打开，请确认下载来源为本项目后，按系统提示在「系统设置 → 隐私与安全性」中允许打开。' > "$staging/安装说明.txt"
hdiutil create -volname Cairn -srcfolder "$staging" -ov -format UDZO "$output"
hdiutil verify "$output"
shasum -a 256 "$output" > "${output}.sha256"
echo "$output"
