import * as vscode from 'vscode';
import { AppState, Shot, SceneBlock } from './types';

/**
 * 导出分镜头脚本为 Markdown
 */
export function exportMarkdown(data: AppState): string {
  const { shots, shootingDay, scriptText } = data;
  const lines: string[] = [];
  const isZh = data.lang === 'zh';

  lines.push(`# ${isZh ? '分镜头脚本' : 'Storyboard'}`);
  lines.push('');
  if (scriptText) {
    lines.push(`## ${isZh ? '原始文案' : 'Original Script'}`);
    lines.push('');
    lines.push(scriptText);
    lines.push('');
  }

  // Shooting info
  if (shootingDay.date || shootingDay.location) {
    lines.push(`## ${isZh ? '拍摄信息' : 'Shooting Info'}`);
    lines.push('');
    if (shootingDay.date) lines.push(`- **${isZh ? '日期' : 'Date'}**: ${shootingDay.date}`);
    if (shootingDay.location) lines.push(`- **${isZh ? '地点' : 'Location'}**: ${shootingDay.location}`);
    lines.push('');
  }

  // Schedule blocks
  if (shootingDay.blocks.length > 0) {
    lines.push(`## ${isZh ? '拍摄日程' : 'Shooting Schedule'}`);
    lines.push('');
    for (const block of shootingDay.blocks) {
      lines.push(`### ${isZh ? '场次' : 'Block'} ${block.blockNo}: ${block.sceneName} (${block.timeSlot})`);
      lines.push('');
      if (block.castNeeded.length) lines.push(`- **${isZh ? '演员' : 'Cast'}**: ${block.castNeeded.join(', ')}`);
      if (block.equipmentNeeded.length) lines.push(`- **${isZh ? '设备' : 'Equipment'}**: ${block.equipmentNeeded.join(', ')}`);
      lines.push(`- **${isZh ? '预计时长' : 'Est. Duration'}**: ${block.estimatedDuration}${isZh ? '分钟' : 'min'}`);
      if (block.notes) lines.push(`- **${isZh ? '备注' : 'Notes'}**: ${block.notes}`);
      lines.push('');
    }
  }

  // Shot table
  lines.push(`## ${isZh ? '镜头列表' : 'Shots'} (${shots.length} ${isZh ? '个镜头' : 'shots'})`);
  lines.push('');

  const totalSec = shots.reduce((s, sh) => s + sh.duration, 0);
  lines.push(`**${isZh ? '总时长' : 'Total Duration'}**: ${Math.floor(totalSec / 60)}m ${totalSec % 60}s`);
  lines.push('');

  const headers = isZh
    ? ['镜号', '场景', '景别', '运镜', '时长', '画面描述', '对白', '转场']
    : ['#', 'Scene', 'Shot Type', 'Camera', 'Dur.', 'Visual', 'Dialogue', 'Transition'];

  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  for (const shot of shots) {
    const row = [
      shot.shotNo,
      shot.sceneName.replace(/\\|/g, '\\\\|'),
      shot.shotType,
      shot.cameraMove,
      `${shot.duration}s`,
      shot.visual.replace(/\\|/g, '\\\\|'),
      shot.dialogue.replace(/\\|/g, '\\\\|'),
      shot.transition,
    ];
    lines.push(`| ${row.join(' | ')} |`);
  }

  // Cast list
  if (shootingDay.castList.length > 0) {
    lines.push('');
    lines.push(`## ${isZh ? '演员表' : 'Cast'}`);
    lines.push('');
    lines.push(`| ${isZh ? '姓名' : 'Name'} | ${isZh ? '角色' : 'Role'} | ${isZh ? '到场时间' : 'Arrival'} | ${isZh ? '联系方式' : 'Contact'} |`);
    lines.push('| --- | --- | --- | --- |');
    for (const c of shootingDay.castList) {
      lines.push(`| ${c.name} | ${c.role} | ${c.arrivalTime} | ${c.contact} |`);
    }
  }

  // Equipment list
  if (shootingDay.equipmentList.length > 0) {
    lines.push('');
    lines.push(`## ${isZh ? '设备清单' : 'Equipment'}`);
    lines.push('');
    lines.push(`| ${isZh ? '设备名' : 'Name'} | ${isZh ? '数量' : 'Qty'} | ${isZh ? '用途' : 'Purpose'} | ${isZh ? '负责人' : 'Person'} |`);
    lines.push('| --- | --- | --- | --- |');
    for (const e of shootingDay.equipmentList) {
      lines.push(`| ${e.name} | ${e.quantity} | ${e.purpose} | ${e.responsible} |`);
    }
  }

  // Budget
  if (shootingDay.budget.length > 0) {
    lines.push('');
    lines.push(`## ${isZh ? '预算' : 'Budget'}`);
    lines.push('');
    lines.push(`| ${isZh ? '类别' : 'Category'} | ${isZh ? '项目' : 'Item'} | ${isZh ? '预估' : 'Est.'} | ${isZh ? '实际' : 'Actual'} |`);
    lines.push('| --- | --- | --- | --- |');
    for (const b of shootingDay.budget) {
      lines.push(`| ${b.category} | ${b.item} | ${b.estimatedCost} | ${b.actualCost} |`);
    }
  }

  return lines.join('\n');
}

/**
 * 导出分镜头脚本为 CSV
 */
export function exportCSV(data: AppState): string {
  const { shots } = data;
  const isZh = data.lang === 'zh';
  const headers = isZh
    ? '镜号,场景,景别,运镜,时长(秒),画面描述,对白,转场,演员,设备,备注'
    : 'Shot#,Scene,ShotType,CameraMove,Duration(s),Visual,Dialogue,Transition,Cast,Equipment,Notes';

  const rows = shots.map(s =>
    [
      s.shotNo,
      `"${s.sceneName.replace(/"/g, '""')}"`,
      `"${s.shotType}"`,
      `"${s.cameraMove}"`,
      s.duration,
      `"${s.visual.replace(/"/g, '""')}"`,
      `"${s.dialogue.replace(/"/g, '""')}"`,
      `"${s.transition}"`,
      `"${s.cast.join('; ')}"`,
      `"${s.equipment.join('; ')}"`,
      `"${s.notes.replace(/"/g, '""')}"`,
    ].join(',')
  );

  return [headers, ...rows].join('\n');
}

/**
 * 导出分镜头脚本为 JSON
 */
export function exportJSON(data: AppState): string {
  return JSON.stringify(data, null, 2);
}

/**
 * 通过 lark-cli 导出到飞书文档
 */
export async function exportToFeishu(data: AppState): Promise<void> {
  const md = exportMarkdown(data);
  const tmpFile = vscode.Uri.joinPath(
    vscode.Uri.file(require('os').tmpdir()),
    `shotboard-${Date.now()}.md`
  );
  await vscode.workspace.fs.writeFile(tmpFile, Buffer.from(md, 'utf8'));

  const terminal = vscode.window.createTerminal('Shotboard Feishu');
  terminal.sendText(
    `npx lark-cli docs +create --title "${escapeTitle(data)}" --local-path "${tmpFile.fsPath}"`
  );
  terminal.show();
}

function escapeTitle(data: AppState): string {
  const date = data.shootingDay.date || new Date().toISOString().slice(0, 10);
  return `分镜头脚本_${date}`;
}
