import * as vscode from 'vscode';
import { ShotboardPanel } from './panel';
import { AppState } from './types';

let currentPanel: ShotboardPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('Shotboard 分镜头脚本编辑器 已激活');

  const openCommand = vscode.commands.registerCommand('shotboard.open', () => {
    if (currentPanel) {
      currentPanel.panel.reveal(vscode.ViewColumn.One);
    } else {
      currentPanel = new ShotboardPanel(context);
      currentPanel.panel.onDidDispose(() => {
        currentPanel = undefined;
      });
    }
  });

  const exportMarkdownCommand = vscode.commands.registerCommand('shotboard.exportMarkdown', async () => {
    if (!currentPanel) {
      vscode.window.showErrorMessage('请先打开 Shotboard 编辑器');
      return;
    }
    currentPanel.postMessage({ type: 'exportMarkdown', data: currentPanel.getState() });
  });

  const exportFeishuCommand = vscode.commands.registerCommand('shotboard.exportFeishu', async () => {
    if (!currentPanel) {
      vscode.window.showErrorMessage('请先打开 Shotboard 编辑器');
      return;
    }
    currentPanel.postMessage({ type: 'exportFeishu', data: currentPanel.getState() });
  });

  context.subscriptions.push(openCommand, exportMarkdownCommand, exportFeishuCommand);
}

export function deactivate() {
  if (currentPanel) {
    currentPanel.panel.dispose();
    currentPanel = undefined;
  }
}
