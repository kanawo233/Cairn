# Cairn

一个面向 macOS 的本地终端原型：Codex 风格的左侧会话列表，右侧是真实的交互式终端。

## 下载与安装

从 [GitHub Releases](https://github.com/kanawo233/Cairn/releases) 下载 DMG，打开后将 **Cairn.app** 拖入 **Applications**。

当前安装包适用于 Apple Silicon Mac（M 系列芯片），不支持 Intel Mac。此预览版尚未经过 Apple Developer ID 签名和公证；首次打开时 macOS 可能拦截，请确认下载来源后按系统提示在「系统设置 → 隐私与安全性」中允许打开。

## 从源码启动

双击 `启动Cairn.command`，或在本目录运行：

```sh
npm install
npm start
```

打包为 Apple Silicon 的 Mac 应用：

```sh
npm run package
npm run dmg
open release/Cairn-darwin-arm64/Cairn.app
```

## 使用

- 左上角「新建终端」或 `⌘ N`：在用户主目录启动独立的登录 Shell。
- 新建按钮右侧的文件夹按钮或 `⌘ ⇧ N`：选择启动目录。
- 点击左侧条目切换；隐藏的会话继续运行，收到新输出时显示蓝点。
- 点击每个终端右侧的「⋯」或右键条目，打开「重命名 / 删除并关闭」菜单。可以直接管理后台终端，不切换当前会话；删除运行中的终端需确认。
- 双击条目或点击右上角「重命名」也可修改名称。
- `⌘ 1` 到 `⌘ 9`：切换到对应终端。
- 终端左侧默认显示行号；在「外观设置 → 显示终端行号」中开关，自动保存。行号对应当前保留内容的显示行，长行折行后分别编号；清屏或历史截断后按剩余内容重新编号。
- `⌘ K`：清空当前终端显示；不停止命令。
- `⌘ W`：关闭当前会话；仍在运行时弹出确认。
- `⌘ ,`：外观设置。支持跟随系统、深空灰、暖白和字体大小；主题、字号与行号开关自动保存，重启后恢复。
- `⌘ +` / `⌘ -`：调整字号；`⌘ 0`：恢复默认字号。
- 常规终端快捷键仍然可用，包括 `Ctrl+C` 中断前台命令。

## 边界

会话和最多 10,000 行滚动记录保留在本次应用运行期间。退出应用会终止所有会话；下次打开创建新会话，不恢复进程。顶部路径明确显示启动目录，暂不跟踪 `cd` 后的目录。应用不内置 AI、账户、遥测或云同步；用户在 Shell 中运行的命令仍可自行访问网络。当前为尚未通过 Apple Developer ID 签名和公证的预览版本。

## 实现与验证

Electron 原生窗口 + node-pty 伪终端 + xterm.js。每个会话拥有独立的 PTY 和终端视图；主进程负责启动、输入、尺寸更新和清理。渲染器启用沙箱与上下文隔离，通过固定 IPC 接口通信，不开放 Node.js 或任意远程页面。

`npm test` 启动真正的 Electron 窗口和 zsh，验证会话隔离、后台输出、切换后保留内容、重命名、主题、窗口尺寸同步、Ctrl+C、退出与空状态。

参考：[Electron 上下文隔离](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[xterm.js 文档](https://xtermjs.org/docs/)、[node-pty](https://github.com/microsoft/node-pty)。
