# 🎬 Shotboard - AI 分镜头脚本编辑器 (VS Code 扩展)

> **VS Code 扩展版** — 在编辑器里直接创作分镜头脚本。
>
> 前端版（双击即用）在 [shotboard-web](../shotboard-web/) 目录。

## 开发

```bash
npm install
npm run compile    # 编译 TypeScript
```

按 `F5` 启动扩展开发调试，然后 `Ctrl+Shift+P` → `Shotboard: 打开分镜头脚本编辑器`

## 项目结构

```
src/
├── types.ts        # 所有类型定义（Shot, SceneBlock, HostDirection...）
├── ai.ts           # AI 调用层（Claude API，含多模态分析）
├── extension.ts    # VS Code 扩展入口
├── panel.ts        # Webview 面板（完整 UI）
├── export.ts       # Markdown/CSV/JSON/飞书导出
└── store.ts        # 状态管理
```

## 技术栈

TypeScript + VS Code Extension API + Anthropic Claude API

## 相关

- 前端版（全功能，推荐直接使用）：`../shotboard-web/index.html`
- 项目文档：[README.md](../shotboard-web/README.md)
