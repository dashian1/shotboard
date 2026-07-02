import * as vscode from 'vscode';
import { AiService } from './ai';
import { AppState, MessageCommand, Shot, VideoType, Lang, TeleprompterEntry, ShootingGroup, ShotCategory, PropsChecklist } from './types';

export class ShotboardPanel {
  public panel: vscode.WebviewPanel;
  private aiService: AiService;
  private state: AppState;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('shotboard');
    const apiKey = config.get<string>('apiKey') || process.env['ANTHROPIC_API_KEY'] || '';
    this.aiService = new AiService(apiKey);

    const lang = config.get<Lang>('language') || 'zh';
    const videoType = config.get<VideoType>('defaultVideoType') || 'product';

    this.state = {
      projectName: '',
      scriptText: '',
      shots: [],
      videoType,
      lang,
      shootingDay: {
        date: new Date().toISOString().slice(0, 10),
        location: '',
        blocks: [],
        castList: [],
        equipmentList: [],
        budget: [],
        notes: '',
      },
      maxShots: config.get<number>('maxShots') || 30,
      mediaInputs: [],
      propsChecklist: { byShot: [], byCategory: {} as any, totalNeeded: {} },
      teleprompter: [],
      shootingGroups: [],
    };

    this.panel = vscode.window.createWebviewPanel(
      'shotboard',
      'Shotboard - AI 导演助理',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
        ],
      }
    );

    this.panel.webview.html = this.getHtmlContent();

    this.panel.webview.onDidReceiveMessage(
      (msg: MessageCommand) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => {
      this.dispose();
    });
  }

  getState(): AppState { return this.state; }
  postMessage(msg: MessageCommand): void { this.panel.webview.postMessage(msg); }

  private async handleMessage(msg: MessageCommand) {
    switch (msg.type) {
      case 'generateV2': {
        const req = msg.request;
        this.state.scriptText = req.script;
        this.state.mediaInputs = req.mediaInputs;
        this.state.venueAnalysis = req.venueAnalysis;
        this.state.productAnalysis = req.productAnalysis;
        this.state.videoAnalysis = req.videoAnalysis;
        try {
          const result = await this.aiService.generateShotsV2(req);
          this.state.shots = result.shots;
          this.state.propsChecklist = { byShot: result.props, byCategory: {} as any, totalNeeded: {} };
          this.state.teleprompter = result.teleprompter;
          const byCategory: any = {};
          for (const cat of ['empty','talking','product','broll','other']) {
            byCategory[cat] = result.shots.filter(s => s.category === cat);
          }
          this.state.propsChecklist.byCategory = byCategory;
          this.postMessage({
            type: 'generateV2Result',
            shots: result.shots,
            props: result.props,
            summary: result.summary,
            teleprompter: result.teleprompter,
          });
        } catch (err: any) {
          this.postMessage({ type: 'error', message: err.message });
        }
        break;
      }

      case 'analyzeVenue': {
        try {
          const analysis = await this.aiService.analyzeVenue(msg.base64);
          this.state.venueAnalysis = analysis;
          this.postMessage({ type: 'analyzeVenueResult', analysis });
        } catch (err: any) {
          this.postMessage({ type: 'error', message: err.message });
        }
        break;
      }

      case 'analyzeProduct': {
        try {
          const analysis = await this.aiService.analyzeProduct(msg.base64);
          this.state.productAnalysis = analysis;
          this.postMessage({ type: 'analyzeProductResult', analysis });
        } catch (err: any) {
          this.postMessage({ type: 'error', message: err.message });
        }
        break;
      }

      case 'suggestSequence': {
        try {
          const groups = await this.aiService.suggestShootingSequence(msg.shots);
          this.state.shootingGroups = groups;
          this.postMessage({ type: 'suggestSequenceResult', groups });
        } catch (err: any) {
          const groups = this.buildDefaultSequence(msg.shots);
          this.state.shootingGroups = groups;
          this.postMessage({ type: 'suggestSequenceResult', groups });
        }
        break;
      }

      case 'generateTeleprompter': {
        try {
          const entries = await this.aiService.generateTeleprompter(msg.shots);
          this.state.teleprompter = entries;
          this.postMessage({ type: 'teleprompterResult', entries });
        } catch (err: any) {
          this.postMessage({ type: 'error', message: err.message });
        }
        break;
      }

      case 'generate': {
        const req = msg.request;
        this.state.scriptText = req.script;
        try {
          const result = await this.aiService.generateShots(req);
          this.state.shots = result.shots;
          this.postMessage({ type: 'generateResult', shots: result.shots, summary: result.summary });
        } catch (err: any) {
          this.postMessage({ type: 'error', message: err.message });
        }
        break;
      }
      case 'suggestSchedule': {
        const req2 = msg.request;
        try {
          const result = await this.aiService.suggestSchedule(req2);
          this.state.shootingDay.blocks = result.blocks;
          this.state.shootingDay.location = req2.location;
          this.postMessage({ type: 'scheduleResult', day: this.state.shootingDay });
        } catch (err: any) {
          this.postMessage({ type: 'error', message: err.message });
        }
        break;
      }
      case 'updateShots': {
        this.state.shots = msg.shots;
        break;
      }
      case 'updateShootingDay': {
        this.state.shootingDay = msg.day;
        break;
      }
      case 'exportMarkdown': {
        const md = this.generateMarkdown(msg.data);
        this.showExportDocument(md, 'markdown');
        break;
      }
      case 'exportCSV': {
        const csv = this.generateCSV(msg.data);
        this.showExportDocument(csv, 'csv');
        break;
      }
      case 'exportFeishu': {
        await this.exportToFeishu(msg.data);
        break;
      }
      case 'exportTeleprompter': {
        const text = this.generateTeleprompterText(msg.entries, msg.lang);
        this.showExportDocument(text, 'plaintext');
        break;
      }
      case 'exportShootingList': {
        const text = this.generateShootingListText(msg.groups, msg.props);
        this.showExportDocument(text, 'markdown');
        break;
      }
      case 'exportPropsChecklist': {
        const text = this.generatePropsChecklistText(msg.props);
        this.showExportDocument(text, 'markdown');
        break;
      }
      case 'exportHostCards': {
        const text = this.generateHostCardsText(msg.shots);
        this.showExportDocument(text, 'markdown');
        break;
      }
      case 'setApiKey': {
        const config = vscode.workspace.getConfiguration('shotboard');
        await config.update('apiKey', msg.apiKey, vscode.ConfigurationTarget.Global);
        this.aiService = new AiService(msg.apiKey);
        this.postMessage({ type: 'showMessage', text: 'API Key 已保存' });
        break;
      }
    }
  }

  private buildDefaultSequence(shots: Shot[]): ShootingGroup[] {
    const categoryOrder: ShotCategory[] = ['empty', 'product', 'broll', 'talking', 'other'];
    const groupNames: Record<ShotCategory, string> = {
      empty: '空镜拍摄', product: '产品展示', broll: 'B-roll 穿插',
      talking: '口播录制', other: '其他镜头',
    };
    const groupNotes: Record<ShotCategory, string> = {
      empty: '主播未到场，先拍场景空镜', product: '纯产品展示，无需主播到场',
      broll: '辅助画面，可穿插拍摄', talking: '主播到场后集中拍摄', other: '',
    };
    return categoryOrder.map((cat, idx) => {
      const groupShots = shots.filter(s => s.category === cat);
      if (groupShots.length === 0) return null;
      const totalMin = groupShots.reduce((s, sh) => s + sh.duration * 8, 0);
      return { groupId: idx + 1, name: groupNames[cat], category: cat, shots: groupShots, estimatedMinutes: Math.ceil(totalMin / 60), note: groupNotes[cat] };
    }).filter(Boolean) as ShootingGroup[];
  }

  private showExportDocument(content: string, language: string) {
    vscode.workspace.openTextDocument({ content, language }).then(d => {
      vscode.window.showTextDocument(d);
    });
  }

  private generateMarkdown(data: AppState): string {
    const { shots, shootingDay, scriptText } = data;
    const lines: string[] = [];
    const isZh = data.lang === 'zh';
    lines.push(`# ${isZh ? '分镜头脚本' : 'Storyboard'}`, '');
    if (scriptText) lines.push(`## ${isZh ? '原始文案' : 'Original Script'}`, '', scriptText, '');
    if (shootingDay.date || shootingDay.location) {
      lines.push(`## ${isZh ? '拍摄信息' : 'Shooting Info'}`);
      if (shootingDay.date) lines.push(`- **${isZh ? '日期' : 'Date'}**: ${shootingDay.date}`);
      if (shootingDay.location) lines.push(`- **${isZh ? '地点' : 'Location'}**: ${shootingDay.location}`);
      lines.push('');
    }
    const catNames: Record<string, string> = { empty: isZh ? '空镜' : 'Empty', talking: isZh ? '口播' : 'Talking', product: isZh ? '产品展示' : 'Product', broll: 'B-roll', other: isZh ? '其他' : 'Other' };
    lines.push(`## ${isZh ? '镜头列表' : 'Shots'} (${shots.length} ${isZh ? '个镜头' : 'shots'})`);
    const totalSec = shots.reduce((s, sh) => s + sh.duration, 0);
    lines.push(`**${isZh ? '总时长' : 'Total Duration'}**: ${Math.floor(totalSec / 60)}m ${totalSec % 60}s`);
    for (const [key, name] of Object.entries(catNames)) {
      const count = shots.filter(s => s.category === key).length;
      if (count > 0) lines.push(`- **${name}**: ${count} ${isZh ? '个' : ''}`);
    }
    lines.push('');
    const headers = isZh ? ['镜号','场景','景别','运镜','时长','画面描述','对白/旁白','转场','分类'] : ['#','Scene','Type','Camera','Dur.','Visual','Dialogue','Transition','Cat.'];
    lines.push(`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`);
    for (const shot of shots) {
      lines.push(`| ${shot.shotNo} | ${shot.sceneName} | ${shot.shotType} | ${shot.cameraMove} | ${shot.duration}s | ${shot.visual.replace(/\|/g, '\\|')} | ${shot.dialogue.replace(/\|/g, '\\|')} | ${shot.transition} | ${catNames[shot.category] || shot.category} |`);
    }
    const talkingShots = shots.filter(s => s.hostDirection);
    if (talkingShots.length > 0) {
      lines.push('', `## ${isZh ? '主播表演指导' : 'Host Directions'}`);
      for (const s of talkingShots) {
        const d = s.hostDirection!;
        lines.push(`- **${isZh ? '镜头' : 'Shot'} #${s.shotNo}**: ${d.tone} | ${d.expression}`);
        if (d.gesture) lines.push(`  - ${isZh ? '手势' : 'Gesture'}: ${d.gesture}`);
        if (d.movement && d.movement !== '无') lines.push(`  - ${isZh ? '走位' : 'Movement'}: ${d.movement}`);
        if (d.emphasisWords.length) lines.push(`  - ${isZh ? '重音' : 'Emphasis'}: ${d.emphasisWords.join(', ')}`);
        lines.push(`  > "${s.dialogue}"`);
        if (d.breathingPoint) lines.push(`  - ⏸ ${isZh ? '换气暂停' : 'Breathing pause'}`);
      }
    }
    return lines.join('\n');
  }

  private generateCSV(data: AppState): string {
    const { shots } = data;
    const headers = '镜号,场景,景别,运镜,时长(秒),画面描述,对白,转场,分类,道具,有口播,纯产品,主播语气,主播表情,主播手势,主播眼神';
    return [headers, ...shots.map(s => [
      s.shotNo, `"${s.sceneName}"`, `"${s.shotType}"`, `"${s.cameraMove}"`, s.duration,
      `"${s.visual.replace(/"/g,'""')}"`, `"${s.dialogue.replace(/"/g,'""')}"`, `"${s.transition}"`,
      s.category, `"${(s.props||[]).join('; ')}"`, s.hasDialogue, s.isProductOnly,
      s.hostDirection?.tone||'', s.hostDirection?.expression||'', s.hostDirection?.gesture||'', s.hostDirection?.eyeDirection||'',
    ].join(','))].join('\n');
  }

  private async exportToFeishu(data: AppState) {
    try {
      const md = this.generateMarkdown(data);
      const tmpFile = vscode.Uri.joinPath(vscode.Uri.file(require('os').tmpdir()), `shotboard-${Date.now()}.md`);
      await vscode.workspace.fs.writeFile(tmpFile, Buffer.from(md, 'utf8'));
      const terminal = vscode.window.createTerminal('Shotboard Feishu');
      terminal.sendText(`npx lark-cli docs +create --title "分镜头脚本_${data.shootingDay.date || new Date().toISOString().slice(0,10)}" --local-path "${tmpFile.fsPath}"`);
      terminal.show();
    } catch (err: any) {
      vscode.window.showErrorMessage(`导出到飞书失败: ${err.message}`);
    }
  }

  private generateTeleprompterText(entries: TeleprompterEntry[], lang: Lang): string {
    return entries.filter(e => e.dialogue).map(e => {
      const parts = [`[${e.duration}s] ${e.dialogue}`];
      if (e.hostDirection) {
        const d = e.hostDirection;
        const dirs: string[] = [];
        if (d.tone) dirs.push(`${lang === 'zh' ? '语气' : 'Tone'}: ${d.tone}`);
        if (d.expression) dirs.push(`${lang === 'zh' ? '表情' : 'Expr'}: ${d.expression}`);
        if (d.gesture) dirs.push(`${lang === 'zh' ? '手势' : 'Gesture'}: ${d.gesture}`);
        if (d.breathingPoint) dirs.push('⏸');
        parts.unshift(`(${dirs.join(' | ')})`);
      }
      return parts.join(' ');
    }).join('\n');
  }

  private generateShootingListText(groups: ShootingGroup[], props: any): string {
    const lines: string[] = ['# 拍摄清单', ''];
    for (const g of groups) {
      lines.push(`## 第${g.groupId}组：${g.name}`, `> ${g.note}`, `**预计时长**: ${g.estimatedMinutes} 分钟`, '');
      for (const shot of g.shots) {
        const catIcon: Record<string, string> = { empty: '🟢', talking: '🔵', product: '🟡', broll: '🟣', other: '⚪' };
        lines.push(`- ${catIcon[shot.category]||'📹'} **镜头 #${shot.shotNo}** | ${shot.shotType} | ${shot.duration}s`);
        if (shot.visual) lines.push(`  ${shot.visual}`);
        if (shot.dialogue) lines.push(`  💬 "${shot.dialogue}"`);
        if (shot.props?.length) lines.push(`  📦 道具: ${shot.props.join(', ')}`);
        if (shot.equipment?.length) lines.push(`  🎥 设备: ${shot.equipment.join(', ')}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  private generatePropsChecklistText(props: PropsChecklist): string {
    const lines: string[] = ['# 道具准备清单', ''];
    lines.push('## 按道具汇总', '| 道具名 | 总数 |', '| --- | --- |');
    for (const [name, qty] of Object.entries(props.totalNeeded)) {
      lines.push(`| ${name} | ${qty} |`);
    }
    lines.push('', '## 按镜头', '', '| 镜号 | 场景 | 道具 | 数量 | 状态 | 备注 |', '| --- | --- | --- | --- | --- | --- |');
    for (const p of props.byShot) {
      const shot = this.state.shots.find(s => s.id === p.shotId);
      const statusIcon = p.status === 'pending' ? '⏳ 待准备' : p.status === 'ready' ? '✅ 已准备' : '⏹ 已核对';
      lines.push(`| ${shot?.shotNo || '-'} | ${p.sceneName} | ${p.name} | ${p.quantity} | ${statusIcon} | ${p.notes} |`);
    }
    return lines.join('\n');
  }

  private generateHostCardsText(shots: Shot[]): string {
    const talkingShots = shots.filter(s => s.hostDirection);
    const lines: string[] = ['# 主播提示卡', ''];
    for (const s of talkingShots) {
      const d = s.hostDirection!;
      lines.push('---', `## 镜头 #${s.shotNo}  |  ${s.duration}s`, '',
        `**语气**: ${d.tone}  |  **表情**: ${d.expression}`,
        `**手势**: ${d.gesture}  |  **眼神**: ${d.eyeDirection}`,
        `**体态**: ${d.posture}  |  **走位**: ${d.movement}`);
      if (d.emphasisWords?.length) lines.push(`**重音强调**: ${d.emphasisWords.join(' → ')}`);
      if (d.breathingPoint) lines.push('**⏸ 此处换气停顿**');
      lines.push('', `> ${s.dialogue}`, '');
    }
    return lines.join('\n');
  }

  private getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Shotboard V2</title>
<style>${this.getCssContent()}</style>
</head><body>
<div id="app">
  <header class="header"><h1>🎬 Shotboard</h1><div class="header-subtitle" id="headerSubtitle">AI 导演助理</div>
    <div class="header-right"><button class="btn btn-icon" id="btnSettings" title="API Key">⚙</button><span class="badge" id="shotCount">0 镜头</span></div>
  </header>
  <nav class="tab-nav" id="tabNav">
    <button class="tab active" data-tab="input">📝 输入</button>
    <button class="tab" data-tab="shots">🎥 分镜头</button>
    <button class="tab" data-tab="category">🏷 分类</button>
    <button class="tab" data-tab="schedule">📅 日程</button>
    <button class="tab" data-tab="checklist">📋 清单</button>
    <button class="tab" data-tab="teleprompter">📺 提词器</button>
    <button class="tab" data-tab="resources">👥 资源</button>
  </nav>
  <main class="content" id="content">

    <!-- Tab: Input -->
    <section class="tab-content active" id="tab-input">
      <div class="dual-pane">
        <div class="pane-left">
          <div class="panel-card input-card"><h3>📝 输入文案</h3>
            <textarea id="scriptInput" rows="12" placeholder="粘贴短视频文案、口播稿或拍摄脚本。建议保留换行，AI 会按信息层级拆分镜头。"></textarea>
            <div class="input-meta">
              <span id="scriptStats">0 字</span>
              <div class="input-actions">
                <button class="btn-small" id="btnInsertTemplate">填入结构模板</button>
                <button class="btn-small" id="btnClearInput">清空</button>
              </div>
            </div>
            <div class="brief-grid">
              <label>目标人群<input type="text" id="audienceInput" placeholder="例：25-35 岁通勤女性"></label>
              <label>拍摄目标<input type="text" id="goalInput" placeholder="例：突出卖点并引导下单"></label>
              <label>画面风格<input type="text" id="styleInput" placeholder="例：干净高级、快节奏、真实测评"></label>
              <label>必须保留<input type="text" id="mustHaveInput" placeholder="例：价格、口号、产品型号"></label>
            </div>
            <textarea id="directionInput" rows="3" placeholder="补充拍摄要求：场景、镜头禁忌、主播状态、不可夸大的内容、品牌语气等。"></textarea>
            <div class="form-row">
              <label>视频类型：</label><select id="videoType">
                <option value="product" selected>📦 带货/产品展示</option>
                <option value="talking">🎙 口播类</option>
                <option value="story">🎬 剧情类</option>
                <option value="vlog">📹 Vlog</option>
                <option value="general">✨ 通用</option>
              </select>
              <label>语言：</label><select id="lang"><option value="zh">中文</option><option value="en">English</option></select>
              <label>最大镜头：</label><input type="number" id="maxShots" value="30" min="5" max="100" style="width:70px">
            </div>
            <button class="btn btn-primary" id="btnGenerateV2">✨ 生成可拍摄分镜</button>
            <span id="loadingIndicator" class="loading hidden">⏳ AI 思考中...</span>
          </div>
        </div>
        <div class="pane-right">
          <div class="panel-card"><h3>🖼 上传素材（可选）</h3>
            <div class="media-upload-area" id="mediaUploadArea">
              <div class="upload-btn-group">
                <label class="upload-btn">🏠 上传场地照<input type="file" accept="image/*" id="venueUpload" hidden></label>
                <label class="upload-btn">📷 上传产品照<input type="file" accept="image/*" id="productUpload" hidden></label>
                <label class="upload-btn">🎬 参考视频描述<input type="file" accept="video/*,.txt" id="videoUpload" hidden></label>
              </div>
              <div id="analysisResults">
                <div class="analysis-item hidden" id="venueAnalysisResult">
                  <h4>🏠 场地分析</h4>
                  <div class="analysis-content"></div>
                  <button class="btn-small" id="editVenueAnalysis">编辑</button>
                </div>
                <div class="analysis-item hidden" id="productAnalysisResult">
                  <h4>📷 产品分析</h4>
                  <div class="analysis-content"></div>
                  <button class="btn-small" id="editProductAnalysis">编辑</button>
                </div>
              </div>
            </div>
          </div>
          <div class="panel-card"><h3>⚡ 快速示例</h3>
            <div class="sample-scripts">
              <div class="sample-item" data-sample="product"><strong>📦 带货示例</strong><p>朋友们，今天给大家带来一款神器——智能保温杯。它最厉害的地方是能保温12小时！你看这个质感，磨砂表面，手感超级棒。底部还有温度显示屏，轻触一下就能看到水温。有了它，冬天喝热水再也不用愁了。</p></div>
              <div class="sample-item" data-sample="talking"><strong>🎙 口播示例</strong><p>大家好，今天想和大家聊聊如何提高工作效率。你有没有这种感觉，从早忙到晚却感觉什么都没做成？其实问题不在于你不够努力，而在于方法不对。</p></div>
            </div>
            <div class="prompt-tips">
              <strong>生成建议</strong>
              <span>写清楚“谁看、为什么看、要记住什么”。</span>
              <span>产品类尽量补充卖点、限制词和使用场景。</span>
              <span>口播类保留自然换行，方便生成提词器。</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Tab: Shots -->
    <section class="tab-content" id="tab-shots">
      <div class="panel-card">
        <div class="table-toolbar">
          <span id="shotsSummary" class="summary-text"></span>
          <div class="toolbar-actions">
            <button class="btn" id="btnAddShot">+ 添加镜头</button>
            <button class="btn" id="btnDeleteSelected">🗑 删除</button>
            <button class="btn" id="btnShowCategory">🏷 分类管理</button>
            <button class="btn btn-secondary" id="btnSuggestScheduleV2">📅 排期 & 清单</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table id="shotTable"><thead><tr>
            <th class="col-select"><input type="checkbox" id="selectAll"></th>
            <th class="col-no">#</th>
            <th class="col-cat">🏷</th>
            <th class="col-scene">场景</th>
            <th class="col-type">景别</th>
            <th class="col-camera">运镜</th>
            <th class="col-dur">时长</th>
            <th class="col-visual">画面描述</th>
            <th class="col-dialogue">对白</th>
            <th class="col-trans">转场</th>
            <th class="col-actions"></th>
          </tr></thead><tbody id="shotBody"></tbody></table>
        </div>
      </div>
    </section>

    <!-- Tab: Category -->
    <section class="tab-content" id="tab-category">
      <div class="panel-card">
        <h3>🏷 镜头分类管理</h3>
        <div class="cat-stats" id="catStats"></div>
      </div>
      <div class="panel-card">
        <div class="table-toolbar">
          <span style="font-size:12px">勾选后批量修改分类</span>
          <div class="toolbar-actions">
            <button class="btn" id="btnBatchToEmpty">🟢 设为空镜</button>
            <button class="btn" id="btnBatchToTalking">🔵 设为口播</button>
            <button class="btn" id="btnBatchToProduct">🟡 设为产品</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table><thead><tr>
            <th class="col-select"><input type="checkbox" id="catSelectAll"></th>
            <th class="col-no">#</th>
            <th>分类</th>
            <th>画面描述</th>
            <th>对白</th>
            <th>道具</th>
            <th>主播指导</th>
          </tr></thead><tbody id="catBody"></tbody></table>
        </div>
      </div>
    </section>

    <!-- Tab: Schedule -->
    <section class="tab-content" id="tab-schedule">
      <div class="panel-card">
        <h3>📅 拍摄日程</h3>
        <div class="form-row">
          <label>日期：</label><input type="date" id="shootDate">
          <label>地点：</label><input type="text" id="shootLocation" placeholder="拍摄地点">
          <label>时间：</label><input type="time" id="startTime" value="09:00"><span>至</span><input type="time" id="endTime" value="18:00">
          <button class="btn btn-secondary" id="btnGenerateSchedule">🤖 AI 建议排期</button>
        </div>
      </div>
      <div id="scheduleTimeline" class="timeline"><div class="timeline-empty">请先生成分镜头</div></div>
    </section>

    <!-- Tab: Checklist -->
    <section class="tab-content" id="tab-checklist">
      <div class="panel-card">
        <h3>📋 拍摄顺序建议</h3>
        <p class="hint">建议顺序：空镜 → 产品展示 → B-roll → 口播（主播集中录制）</p>
        <div id="shootingGroups"></div>
      </div>
      <div class="panel-card">
        <h3>📦 道具准备清单</h3>
        <div class="table-toolbar">
          <span id="propsSummary"></span>
        </div>
        <div id="propsTable"></div>
      </div>
    </section>

    <!-- Tab: Teleprompter -->
    <section class="tab-content" id="tab-teleprompter">
      <div class="teleprompter-container">
        <div class="teleprompter-main" id="teleprompterMain">
          <div class="teleprompter-text" id="teleprompterText">
            <div class="teleprompter-placeholder">暂无提词数据。请先生成分镜头。</div>
          </div>
          <div class="teleprompter-sidebar" id="tpSidebar">
            <div class="tp-host-card" id="tpHostCard">
              <div class="tp-host-placeholder">选择口播镜头查看主播指导</div>
            </div>
          </div>
        </div>
        <div class="teleprompter-controls">
          <button class="btn btn-primary" id="tpPlay">▶ 播放</button>
          <button class="btn" id="tpPause">⏸ 暂停</button>
          <button class="btn" id="tpReset">⏹ 重置</button>
          <label>速度：<input type="range" id="tpSpeed" min="0.5" max="3" step="0.25" value="1"></label>
          <span id="tpSpeedLabel">1.0x</span>
          <label>字号：<input type="range" id="tpFontSize" min="16" max="48" step="2" value="28"></label>
          <span id="tpFontSizeLabel">28px</span>
        </div>
      </div>
    </section>

    <!-- Tab: Resources -->
    <section class="tab-content" id="tab-resources">
      <div class="panel-card"><h3>👤 演员表</h3>
        <table><thead><tr><th>姓名</th><th>角色</th><th>到场时间</th><th>联系方式</th><th>备注</th><th></th></tr></thead>
        <tbody id="castBody"></tbody></table>
        <button class="btn" id="btnAddCast">+ 添加演员</button>
      </div>
      <div class="panel-card"><h3>📦 设备清单</h3>
        <table><thead><tr><th>设备名</th><th>数量</th><th>用途</th><th>负责人</th><th>费用</th><th></th></tr></thead>
        <tbody id="equipBody"></tbody></table>
        <button class="btn" id="btnAddEquip">+ 添加设备</button>
      </div>
    </section>

  </main>
  <footer class="footer">
    <button class="btn" id="btnExportMarkdown">📄 MD</button>
    <button class="btn" id="btnExportCSV">📊 CSV</button>
    <button class="btn" id="btnExportTeleprompter">📺 提词文本</button>
    <button class="btn" id="btnExportShootingList">📋 拍摄清单</button>
    <button class="btn" id="btnExportHostCards">🎬 主播卡</button>
    <button class="btn" id="btnExportFeishu">📤 飞书</button>
  </footer>
  <div class="modal-overlay hidden" id="settingsModal"><div class="modal">
    <h3>⚙ 设置</h3>
    <div class="form-row"><label>Anthropic API Key：</label><input type="password" id="apiKeyInput" placeholder="sk-ant-..." style="flex:1"><button class="btn" id="btnSaveApiKey">保存</button></div>
    <p class="hint">也支持 ANTHROPIC_API_KEY 环境变量</p>
    <button class="btn" id="btnCloseSettings">关闭</button>
  </div></div>
</div>
<script>${this.getJsContent()}</script>
</body></html>`;
  }

  private getCssContent(): string {
    return `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;line-height:1.5;color:var(--vscode-editor-foreground,#333);background:var(--vscode-editor-background,#fff)}
#app{display:flex;flex-direction:column;min-height:100vh}
.header{display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--vscode-titleBar-activeBackground,#f5f5f5);border-bottom:1px solid var(--vscode-panel-border,#ddd)}
.header h1{font-size:18px;font-weight:600;margin:0}
.header-subtitle{font-size:12px;opacity:.7;flex:1}
.header-right{display:flex;align-items:center;gap:8px}
.tab-nav{display:flex;border-bottom:1px solid var(--vscode-panel-border,#ddd);overflow-x:auto}
.tab{padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;opacity:.6;white-space:nowrap}
.tab:hover{opacity:.8}
.tab.active{opacity:1;border-bottom-color:var(--vscode-button-background,#0078d4);font-weight:600}
.content{flex:1;padding:12px 16px;overflow-y:auto}
.tab-content{display:none}
.tab-content.active{display:block}
.panel-card{background:var(--vscode-sideBar-background,#f8f8f8);border:1px solid var(--vscode-panel-border,#ddd);border-radius:8px;padding:14px;margin-bottom:12px}
.panel-card h3{font-size:14px;margin-bottom:10px}
textarea,input,select{width:100%;padding:7px 10px;border:1px solid var(--vscode-input-border,#ccc);border-radius:4px;font-family:inherit;font-size:13px;background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground,#333)}
textarea:focus,input:focus,select:focus{outline:none;border-color:var(--vscode-focusBorder,#0078d4)}
textarea{resize:vertical}
.form-row{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}
.form-row label{font-size:12px;font-weight:500;white-space:nowrap}
.form-row select,.form-row input{width:auto}
.btn{padding:6px 14px;border:1px solid transparent;border-radius:4px;cursor:pointer;font-size:13px;background:var(--vscode-button-secondaryBackground,#e0e0e0);color:var(--vscode-button-secondaryForeground,#333)}
.btn:hover{filter:brightness(.95)}
.btn-primary{background:var(--vscode-button-background,#0078d4);color:var(--vscode-button-foreground,white);font-weight:500}
.btn-secondary{background:var(--vscode-button-secondaryBackground,#e0e0e0)}
.btn-small{padding:2px 8px;font-size:11px;border:1px solid #ccc;border-radius:3px;cursor:pointer;background:var(--vscode-button-secondaryBackground,#eee);margin-top:4px}
.btn-icon{padding:4px 8px;font-size:16px;line-height:1;border:none;background:none;cursor:pointer}
.badge{display:inline-block;padding:2px 10px;border-radius:10px;background:var(--vscode-badge-background,#0078d4);color:var(--vscode-badge-foreground,white);font-size:11px;font-weight:500}
.dual-pane{display:flex;gap:16px}
.pane-left,.pane-right{flex:1;min-width:0}
.media-upload-area{padding:4px 0}
.upload-btn-group{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.upload-btn{display:inline-block;padding:6px 14px;border:1px dashed var(--vscode-panel-border,#aaa);border-radius:6px;cursor:pointer;font-size:12px;background:var(--vscode-input-background,#fff)}
.upload-btn:hover{border-color:var(--vscode-button-background,#0078d4);background:var(--vscode-list-hoverBackground,#e8f4ff)}
.analysis-item{margin-top:8px;padding:8px;background:var(--vscode-editor-background,#fff);border-radius:4px;border-left:3px solid var(--vscode-button-background,#0078d4)}
.analysis-item h4{font-size:12px;margin-bottom:4px}
.analysis-content{font-size:11px;opacity:.8;white-space:pre-wrap}
.hint{font-size:11px;opacity:.5;margin:4px 0}
.input-card textarea{margin-bottom:8px}
.input-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-2px 0 10px;font-size:11px;opacity:.72}
.input-actions{display:flex;gap:6px;flex-wrap:wrap}
.brief-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:8px 0}
.brief-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:500}
.prompt-tips{display:grid;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--vscode-panel-border,#ddd);font-size:12px;opacity:.75}
.prompt-tips strong{opacity:1}
.sample-scripts{display:flex;gap:8px;flex-wrap:wrap}
.sample-item{flex:1;min-width:150px;padding:10px;border:1px dashed var(--vscode-panel-border,#ccc);border-radius:6px;cursor:pointer;font-size:12px}
.sample-item:hover{border-color:var(--vscode-button-background,#0078d4);background:var(--vscode-list-hoverBackground,#e8e8e8)}
.sample-item p{margin-top:4px;opacity:.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}

/* Tables */
.table-wrapper{overflow-x:auto}
.table-toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px}
.toolbar-actions{display:flex;gap:4px}
.summary-text{font-size:12px;opacity:.7}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:5px 6px;border:1px solid var(--vscode-panel-border,#ddd);text-align:left;white-space:nowrap}
th{background:var(--vscode-sideBarSectionHeader-background,#eee);font-weight:600;position:sticky;top:0}
td[contenteditable="true"]:focus{outline:2px solid var(--vscode-focusBorder,#0078d4);outline-offset:-1px;background:var(--vscode-input-background,#fff)}
.empty-cell{text-align:center;padding:30px!important;opacity:.5;font-style:italic}
.col-select{width:30px}
.col-no{width:36px}
.col-cat{width:50px}
.col-dur{width:50px}
.col-actions{width:36px}

/* Category tags */
.cat-tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:500;color:#fff}
.cat-empty{background:#2da44e}
.cat-talking{background:#0969da}
.cat-product{background:#d4a72c;color:#222}
.cat-broll{background:#8250df}
.cat-other{background:#8b949e}
.cat-select{padding:1px 4px;border-radius:10px;font-size:11px;border:1px solid #ccc;background:transparent}
.cat-stats{display:flex;gap:16px;font-size:12px;flex-wrap:wrap;margin-bottom:8px}
.cat-stat{padding:4px 12px;border-radius:12px;color:#fff;font-weight:500}

/* Timeline */
.timeline{padding:8px 0}
.timeline-empty{text-align:center;padding:40px;opacity:.5}
.timeline-block{margin:6px 0;padding:10px 14px;border-radius:6px;border:1px solid var(--vscode-panel-border,#ddd);background:var(--vscode-sideBar-background,#f8f8f8)}
.timeline-block:hover{border-color:var(--vscode-focusBorder,#0078d4)}
.block-header{display:flex;justify-content:space-between;align-items:center}
.block-time{font-weight:600;color:var(--vscode-button-background,#0078d4)}
.block-scene{font-weight:500}
.block-meta{font-size:11px;opacity:.6;margin-top:2px}

/* Checklist groups */
.shooting-group{margin:8px 0;padding:10px 14px;border-radius:6px;border:1px solid var(--vscode-panel-border,#ddd);border-left:4px solid #0078d4}
.shooting-group.group-empty{border-left-color:#2da44e}
.shooting-group.group-product{border-left-color:#d4a72c}
.shooting-group.group-talking{border-left-color:#0969da}
.shooting-group.group-broll{border-left-color:#8250df}
.group-header{display:flex;justify-content:space-between;align-items:center}
.group-name{font-weight:600;font-size:14px}
.group-time{font-size:12px;opacity:.7}
.group-note{font-size:11px;opacity:.6;margin:2px 0 6px}
.group-shots{display:flex;flex-wrap:wrap;gap:4px}
.group-shot{padding:2px 8px;border-radius:4px;font-size:11px;background:var(--vscode-editor-background,#fff);border:1px solid #ddd}

/* Teleprompter */
.teleprompter-container{display:flex;flex-direction:column;height:calc(100vh - 200px);position:relative}
.teleprompter-main{flex:1;background:#111;color:#fff;padding:40px;overflow:hidden;position:relative;border-radius:8px;min-height:300px}
.teleprompter-text{text-align:center;position:absolute;left:20px;right:280px;width:auto;top:100%;transition:none;line-height:1}
.teleprompter-text .tp-line{padding:12px 20px;font-size:28px;line-height:1.6;opacity:.3;transition:opacity .3s}
.teleprompter-text .tp-line.current-dialogue{opacity:1;font-weight:600;background:rgba(255,255,255,.08);border-radius:8px}
.teleprompter-text .tp-line.tp-guide{font-size:14px;opacity:.5;font-style:italic}
.teleprompter-placeholder{text-align:center;padding:60px 20px;opacity:.5;font-style:italic}
.teleprompter-sidebar{position:absolute;right:10px;top:20px;width:260px;background:rgba(255,255,255,.05);border-radius:8px;padding:16px;color:#fff;z-index:10}
.tp-host-card{font-size:12px;line-height:1.6}
.tp-host-placeholder{opacity:.5;font-style:italic;text-align:center;padding:20px}
.teleprompter-controls{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#222;border-radius:8px;margin-top:8px;color:#fff;flex-wrap:wrap}
.teleprompter-controls label{font-size:12px;display:flex;align-items:center;gap:4px;color:#ccc}
.teleprompter-controls input[type=range]{width:80px}

/* Footer */
.footer{display:flex;gap:6px;padding:8px 16px;border-top:1px solid var(--vscode-panel-border,#ddd);background:var(--vscode-statusBar-background,#007acc);flex-wrap:wrap}
.footer .btn{background:rgba(255,255,255,.15);color:white;border:1px solid rgba(255,255,255,.2);font-size:12px;padding:4px 10px}
.footer .btn:hover{background:rgba(255,255,255,.25)}

/* Modal */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:var(--vscode-editor-background,#fff);padding:24px;border-radius:8px;min-width:380px}
.hidden{display:none!important}
.loading{font-style:italic;animation:pulse 1s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background,#c0c0c0);border-radius:3px}
.btn-delete{padding:2px 6px;font-size:12px;background:none;border:none;cursor:pointer;opacity:.4}
.btn-delete:hover{opacity:1;color:#d32f2f}
@media(max-width:768px){.dual-pane{flex-direction:column}.brief-grid{grid-template-columns:1fr}}
`;
  }

  private getJsContent(): string {
    return `
(function() {
  const vscode = acquireVsCodeApi();
  let state = {
    shots: [],
    shootingDay: { date: '', location: '', blocks: [], castList: [], equipmentList: [], budget: [] },
    lang: 'zh', videoType: 'product', maxShots: 30,
    venueAnalysis: null, productAnalysis: null, videoAnalysis: null,
    mediaInputs: [],
    propsChecklist: { byShot: [], byCategory: {}, totalNeeded: {} },
    teleprompter: [],
    shootingGroups: [],
  };

  const $ = function(id) { return document.getElementById(id); };
  const scriptInput = $('scriptInput');
  const directionInput = $('directionInput');
  const audienceInput = $('audienceInput');
  const goalInput = $('goalInput');
  const styleInput = $('styleInput');
  const mustHaveInput = $('mustHaveInput');
  const scriptStats = $('scriptStats');
  const videoType = $('videoType');
  const lang = $('lang');
  const maxShots = $('maxShots');
  const btnGenerateV2 = $('btnGenerateV2');
  const loadingInd = $('loadingIndicator');
  const shotBody = $('shotBody');
  const shotsSummary = $('shotsSummary');
  const shotCount = $('shotCount');
  const catBody = $('catBody');
  const catStats = $('catStats');

  // Tab switching
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('tab-' + this.dataset.tab).classList.add('active');
    });
  });

  function escHtml(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function getCreativeBrief() {
    var lines = [];
    if (audienceInput.value.trim()) lines.push('目标人群：' + audienceInput.value.trim());
    if (goalInput.value.trim()) lines.push('拍摄目标：' + goalInput.value.trim());
    if (styleInput.value.trim()) lines.push('画面风格：' + styleInput.value.trim());
    if (mustHaveInput.value.trim()) lines.push('必须保留：' + mustHaveInput.value.trim());
    if (directionInput.value.trim()) lines.push('补充要求：' + directionInput.value.trim());
    return lines.join('\\n');
  }

  function buildPromptScript() {
    var script = scriptInput.value.trim();
    var brief = getCreativeBrief();
    if (!brief) return script;
    return script + '\\n\\n## 创作补充要求\\n' + brief;
  }

  function updateScriptStats() {
    var text = scriptInput.value.trim();
    var brief = getCreativeBrief();
    var count = text.replace(/\\s/g, '').length;
    scriptStats.textContent = count + ' 字' + (brief ? ' · 已加入补充要求' : '');
  }

  function getAppState() {
    return { projectName: '', scriptText: buildPromptScript(), shots: state.shots, videoType: state.videoType, lang: state.lang, shootingDay: state.shootingDay, maxShots: state.maxShots, mediaInputs: state.mediaInputs, venueAnalysis: state.venueAnalysis, productAnalysis: state.productAnalysis, videoAnalysis: state.videoAnalysis, propsChecklist: state.propsChecklist, teleprompter: state.teleprompter, shootingGroups: state.shootingGroups };
  }

  const CAT_NAMES = { empty: '空镜', talking: '口播', product: '产品展示', broll: 'B-roll', other: '其他' };
  const CAT_CLASS = { empty: 'cat-empty', talking: 'cat-talking', product: 'cat-product', broll: 'cat-broll', other: 'cat-other' };
  const CAT_ICON = { empty: '🟢', talking: '🔵', product: '🟡', broll: '🟣', other: '⚪' };

  function catTag(cat) {
    var name = CAT_NAMES[cat] || cat;
    var cls = CAT_CLASS[cat] || 'cat-other';
    return '<span class="cat-tag ' + cls + '">' + name + '</span>';
  }

  // Shot table
  function renderShotTable(shots) {
    if (!shots || shots.length === 0) {
      shotBody.innerHTML = '<tr><td colspan="11" class="empty-cell">暂无镜头。先在「输入」生成。</td></tr>';
      shotsSummary.textContent = ''; shotCount.textContent = '0 镜头'; return;
    }
    var totalSec = shots.reduce(function(s, sh) { return s + (sh.duration || 0); }, 0);
    shotsSummary.textContent = '共 ' + shots.length + ' 镜头，总时长 ' + Math.floor(totalSec/60) + 'm ' + (totalSec%60) + 's';
    shotCount.textContent = shots.length + ' 镜头';
    shotBody.innerHTML = shots.map(function(shot) {
      return '<tr data-id="' + shot.id + '">' +
        '<td><input type="checkbox" class="shot-select"></td>' +
        '<td>' + shot.shotNo + '</td>' +
        '<td>' + catTag(shot.category) + '</td>' +
        '<td contenteditable="true" data-field="sceneName">' + escHtml(shot.sceneName) + '</td>' +
        '<td contenteditable="true" data-field="shotType">' + escHtml(shot.shotType) + '</td>' +
        '<td contenteditable="true" data-field="cameraMove">' + escHtml(shot.cameraMove) + '</td>' +
        '<td contenteditable="true" data-field="duration">' + shot.duration + '</td>' +
        '<td contenteditable="true" data-field="visual">' + escHtml(shot.visual) + '</td>' +
        '<td contenteditable="true" data-field="dialogue">' + escHtml(shot.dialogue) + '</td>' +
        '<td contenteditable="true" data-field="transition">' + escHtml(shot.transition) + '</td>' +
        '<td><button class="btn-delete" data-id="' + shot.id + '">✕</button></td></tr>';
    }).join('');
    shotBody.querySelectorAll('td[contenteditable]').forEach(function(td) {
      td.addEventListener('blur', function() {
        var id = this.closest('tr').dataset.id;
        var field = this.dataset.field;
        var val = this.textContent.trim();
        var shot = state.shots.find(function(s) { return s.id === id; });
        if (shot) {
          if (field === 'duration') shot[field] = parseInt(val) || 0;
          else shot[field] = val;
          vscode.postMessage({ type: 'updateShots', shots: state.shots });
        }
      });
    });
    shotBody.querySelectorAll('.btn-delete').forEach(function(btn) {
      btn.addEventListener('click', function() {
        state.shots = state.shots.filter(function(s) { return s.id !== this.dataset.id; }.bind(this));
        renderShotTable(state.shots); renderCatTable(state.shots);
        vscode.postMessage({ type: 'updateShots', shots: state.shots });
      });
    });
  }

  // Category table
  function renderCatTable(shots) {
    if (!shots || shots.length === 0) {
      catBody.innerHTML = '<tr><td colspan="6" class="empty-cell">暂无镜头</td></tr>';
      catStats.innerHTML = ''; return;
    }
    var counts = { empty: 0, talking: 0, product: 0, broll: 0, other: 0 };
    shots.forEach(function(s) { if (counts[s.category] !== undefined) counts[s.category]++; });
    var statColors = { empty: '#2da44e', talking: '#0969da', product: '#d4a72c', broll: '#8250df', other: '#8b949e' };
    catStats.innerHTML = Object.entries(counts).filter(function(e) { return e[1] > 0; }).map(function(e) {
      return '<span class="cat-stat" style="background:' + statColors[e[0]] + '">' + CAT_ICON[e[0]] + ' ' + CAT_NAMES[e[0]] + ': ' + e[1] + '</span>';
    }).join('') + '<span style="font-size:12px;opacity:.6;margin-left:auto">总计 ' + shots.length + ' 镜头</span>';

    catBody.innerHTML = shots.map(function(shot) {
      var d = shot.hostDirection;
      var dirStr = d ? escHtml(d.tone + ' | ' + d.expression) : '';
      return '<tr data-id="' + shot.id + '">' +
        '<td><input type="checkbox" class="cat-select-cb"></td>' +
        '<td>' + shot.shotNo + '</td>' +
        '<td><select class="cat-select" onchange="window.__catChange(this)" data-id="' + shot.id + '">' +
          ['empty','talking','product','broll','other'].map(function(c) { return '<option value="' + c + '"' + (c === shot.category ? ' selected' : '') + '>' + CAT_ICON[c] + ' ' + CAT_NAMES[c] + '</option>'; }).join('') +
        '</select></td>' +
        '<td>' + escHtml(shot.visual).substring(0, 60) + (shot.visual.length > 60 ? '...' : '') + '</td>' +
        '<td>' + escHtml(shot.dialogue).substring(0, 40) + '</td>' +
        '<td>' + escHtml((shot.props||[]).join(', ')) + '</td>' +
        '<td style="font-size:11px;opacity:.7">' + dirStr + '</td></tr>';
    }).join('');
  }

  window.__catChange = function(sel) {
    var id = sel.dataset.id;
    var shot = state.shots.find(function(s) { return s.id === id; });
    if (shot) { shot.category = sel.value; vscode.postMessage({ type: 'updateShots', shots: state.shots }); }
    renderShotTable(state.shots);
    renderCatTable(state.shots);
  };

  // Generate V2
  btnGenerateV2.addEventListener('click', function() {
    var text = buildPromptScript();
    if (!text) { alert('请输入文案'); return; }
    loadingInd.classList.remove('hidden');
    this.disabled = true;
    state.lang = lang.value;
    state.videoType = videoType.value;
    state.maxShots = parseInt(maxShots.value) || 30;
    vscode.postMessage({
      type: 'generateV2',
      request: {
        script: text, videoType: state.videoType, lang: state.lang, maxShots: state.maxShots,
        mediaInputs: state.mediaInputs,
        venueAnalysis: state.venueAnalysis,
        productAnalysis: state.productAnalysis,
        videoAnalysis: state.videoAnalysis,
      }
    });
  });

  // Sample scripts
  document.querySelectorAll('.sample-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var p = this.querySelector('p');
      if (p) scriptInput.value = p.textContent;
      if (this.dataset.sample === 'product') {
        videoType.value = 'product';
        goalInput.value = goalInput.value || '突出核心卖点，生成可直接拍摄的带货分镜';
        styleInput.value = styleInput.value || '干净、有节奏、产品细节明确';
      }
      if (this.dataset.sample === 'talking') {
        videoType.value = 'talking';
        goalInput.value = goalInput.value || '把观点讲清楚，口播自然，有 B-roll 遮挡剪辑';
        styleInput.value = styleInput.value || '真实、亲切、信息密度高';
      }
      updateScriptStats();
    });
  });

  [scriptInput, directionInput, audienceInput, goalInput, styleInput, mustHaveInput].forEach(function(el) {
    el.addEventListener('input', updateScriptStats);
  });
  $('btnClearInput').addEventListener('click', function() {
    scriptInput.value = '';
    directionInput.value = '';
    audienceInput.value = '';
    goalInput.value = '';
    styleInput.value = '';
    mustHaveInput.value = '';
    updateScriptStats();
  });
  $('btnInsertTemplate').addEventListener('click', function() {
    if (!scriptInput.value.trim()) {
      scriptInput.value = '开场钩子：\\n\\n核心痛点：\\n\\n产品/观点亮点：\\n\\n使用场景：\\n\\n结尾行动：';
    }
    updateScriptStats();
    scriptInput.focus();
  });
  updateScriptStats();

  // Media upload
  $('venueUpload').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(',')[1];
      state.mediaInputs.push({ type: 'venue', localPath: file.name, base64Data: base64 });
      vscode.postMessage({ type: 'analyzeVenue', base64: base64 });
    };
    reader.readAsDataURL(file);
  });
  $('productUpload').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(',')[1];
      state.mediaInputs.push({ type: 'product_photo', localPath: file.name, base64Data: base64 });
      vscode.postMessage({ type: 'analyzeProduct', base64: base64 });
    };
    reader.readAsDataURL(file);
  });
  $('videoUpload').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(ev) {
      var text = ev.target.result;
      state.mediaInputs.push({ type: 'reference_video', localPath: file.name, description: text.substring(0,500) });
    };
    reader.readAsText(file);
  });

  // Shot operations
  $('btnAddShot').addEventListener('click', function() {
    var lastNo = state.shots.length > 0 ? Math.max.apply(null, state.shots.map(function(s) { return s.shotNo; })) : 0;
    var newShot = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2,8),
      shotNo: lastNo + 1, sceneName: '', shotType: '', cameraMove: '', duration: 3,
      visual: '', dialogue: '', transition: '', cast: [], equipment: [], notes: '',
      category: 'other', props: [], hasDialogue: false, isProductOnly: false,
    };
    state.shots.push(newShot);
    renderShotTable(state.shots); renderCatTable(state.shots);
    vscode.postMessage({ type: 'updateShots', shots: state.shots });
  });

  $('btnDeleteSelected').addEventListener('click', function() {
    var checked = shotBody.querySelectorAll('.shot-select:checked');
    var ids = new Set(Array.from(checked).map(function(cb) { return cb.closest('tr').dataset.id; }));
    if (ids.size === 0) return;
    state.shots = state.shots.filter(function(s) { return !ids.has(s.id); });
    state.shots.forEach(function(s, i) { s.shotNo = i + 1; });
    renderShotTable(state.shots); renderCatTable(state.shots);
    vscode.postMessage({ type: 'updateShots', shots: state.shots });
  });

  $('selectAll').addEventListener('change', function() {
    shotBody.querySelectorAll('.shot-select').forEach(function(cb) { cb.checked = this.checked; }.bind(this));
  });

  // Category batch ops
  $('btnBatchToEmpty').addEventListener('click', function() { batchCat('empty'); });
  $('btnBatchToTalking').addEventListener('click', function() { batchCat('talking'); });
  $('btnBatchToProduct').addEventListener('click', function() { batchCat('product'); });
  function batchCat(cat) {
    var checked = catBody.querySelectorAll('.cat-select-cb:checked');
    if (checked.length === 0) { alert('请先在分类 Tab 勾选镜头'); return; }
    checked.forEach(function(cb) {
      var id = cb.closest('tr').dataset.id;
      var shot = state.shots.find(function(s) { return s.id === id; });
      if (shot) shot.category = cat;
    });
    renderShotTable(state.shots); renderCatTable(state.shots);
    vscode.postMessage({ type: 'updateShots', shots: state.shots });
  }
  $('catSelectAll').addEventListener('change', function() {
    catBody.querySelectorAll('.cat-select-cb').forEach(function(cb) { cb.checked = this.checked; }.bind(this));
  });

  // Schedule
  $('shootDate').value = new Date().toISOString().slice(0, 10);
  $('btnGenerateSchedule').addEventListener('click', function() {
    if (state.shots.length === 0) { alert('请先有镜头'); return; }
    vscode.postMessage({
      type: 'suggestSchedule',
      request: { shots: state.shots, startTime: $('startTime').value || '09:00', endTime: $('endTime').value || '18:00', location: $('shootLocation').value || '' }
    });
  });

  // Shooting Groups
  function renderShootingGroups(groups) {
    var el = $('shootingGroups');
    if (!groups || groups.length === 0) {
      el.innerHTML = '<div class="timeline-empty">请生成镜头后，在分镜头 Tab 点击「排期 & 清单」</div>'; return;
    }
    el.innerHTML = groups.map(function(g) {
      return '<div class="shooting-group group-' + g.category + '">' +
        '<div class="group-header"><span class="group-name">第' + g.groupId + '组：' + escHtml(g.name) + '</span><span class="group-time">约 ' + g.estimatedMinutes + ' 分钟</span></div>' +
        '<div class="group-note">' + escHtml(g.note) + '</div>' +
        '<div class="group-shots">' + g.shots.map(function(s) { return '<span class="group-shot">#' + s.shotNo + ' ' + escHtml(s.visual).substring(0,30) + (s.visual.length>30?'...':'') + '</span>'; }).join('') +
        '</div></div>';
    }).join('');
  }

  // Props table
  function renderPropsTable(props) {
    var el = $('propsTable');
    var summary = $('propsSummary');
    if (!props || !props.byShot || props.byShot.length === 0) {
      el.innerHTML = '<div class="timeline-empty">暂无道具数据</div>';
      summary.textContent = ''; return;
    }
    var html = '<table><thead><tr><th>镜号</th><th>场景</th><th>道具</th><th>数量</th><th>状态</th><th>备注</th></tr></thead><tbody>';
    props.byShot.forEach(function(p) {
      var shot = state.shots.find(function(s) { return s.id === p.shotId; });
      var statusIcon = p.status === 'pending' ? '⏳' : '✅';
      html += '<tr><td>' + (shot?.shotNo || '-') + '</td><td>' + escHtml(p.sceneName) + '</td><td>' + escHtml(p.name) + '</td><td>' + p.quantity + '</td><td>' + statusIcon + ' ' + p.status + '</td><td>' + escHtml(p.notes) + '</td></tr>';
    });
    html += '</tbody></table>';
    if (props.totalNeeded) {
      html += '<h4 style="margin-top:12px;font-size:13px">📊 道具汇总</h4><table><thead><tr><th>道具</th><th>总数</th></tr></thead><tbody>';
      for (var name in props.totalNeeded) {
        html += '<tr><td>' + escHtml(name) + '</td><td>' + props.totalNeeded[name] + '</td></tr>';
      }
      html += '</tbody></table>';
    }
    el.innerHTML = html;
    summary.textContent = '共 ' + props.byShot.length + ' 条道具记录';
  }

  // Teleprompter
  var tpPlaying = false, tpPaused = false, tpPos = 0, tpTimer = null;
  var tpText = $('teleprompterText');
  var tpHostCard = $('tpHostCard');
  var tpSpeed = $('tpSpeed');
  var tpFontSize = $('tpFontSize');

  function renderTeleprompter(entries) {
    if (!entries || entries.length === 0) {
      tpText.innerHTML = '<div class="teleprompter-placeholder">暂无提词数据</div>'; return;
    }
    tpText.innerHTML = entries.map(function(e, i) {
      var guide = e.hostDirection ? '<div class="tp-line tp-guide">[' + escHtml(e.hostDirection.tone + ' | ' + e.hostDirection.expression) + ']</div>' : '';
      return '<div class="tp-line" data-tp-idx="' + i + '">' + guide + '<div class="tp-dialogue">' + escHtml(e.dialogue || '(无对白)') + '</div></div>';
    }).join('');
    tpPos = 0;
    updateTpPos();
  }

  function updateTpPos() {
    var lines = tpText.querySelectorAll('.tp-line');
    lines.forEach(function(l, i) { l.classList.toggle('current-dialogue', i === tpPos); });
    var entries = state.teleprompter;
    if (entries && entries[tpPos] && entries[tpPos].hostDirection) {
      var d = entries[tpPos].hostDirection;
      tpHostCard.innerHTML =
        '<div style="font-size:14px;font-weight:600;margin-bottom:8px">🎬 镜头 #' + entries[tpPos].shotNo + '</div>' +
        '<div><strong>语气</strong>: ' + escHtml(d.tone) + '</div>' +
        '<div><strong>表情</strong>: ' + escHtml(d.expression) + '</div>' +
        '<div><strong>手势</strong>: ' + escHtml(d.gesture) + '</div>' +
        '<div><strong>眼神</strong>: ' + escHtml(d.eyeDirection) + '</div>' +
        '<div><strong>体态</strong>: ' + escHtml(d.posture) + '</div>' +
        '<div><strong>走位</strong>: ' + escHtml(d.movement) + '</div>' +
        (d.emphasisWords && d.emphasisWords.length ? '<div><strong>重音</strong>: ' + d.emphasisWords.join(', ') + '</div>' : '') +
        (d.breathingPoint ? '<div style="color:#ffd700;margin-top:4px">⏸ 换气/停顿</div>' : '');
    } else if (entries && entries[tpPos]) {
      tpHostCard.innerHTML = '<div style="font-size:14px;font-weight:600;margin-bottom:8px">🎬 镜头 #' + entries[tpPos].shotNo + '</div><div style="opacity:.6">' + escHtml(entries[tpPos].dialogue) + '</div>';
    } else {
      tpHostCard.innerHTML = '<div class="tp-host-placeholder">选择镜头查看详情</div>';
    }
    var active = tpText.querySelector('.current-dialogue');
    if (active) {
      var container = tpText.parentElement;
      var offset = active.offsetTop - container.offsetTop - container.clientHeight / 2 + active.clientHeight / 2;
      tpText.style.transform = 'translateY(-' + offset + 'px)';
    }
  }

  $('tpPlay').addEventListener('click', function() {
    if (!state.teleprompter || state.teleprompter.length === 0) return;
    if (tpPaused) { tpPaused = false; return; }
    tpPlaying = true; tpPaused = false;
    if (tpTimer) clearInterval(tpTimer);
    tpTimer = setInterval(function() {
      if (tpPaused) return;
      tpPos++;
      if (tpPos >= state.teleprompter.length) { tpPos = 0; clearInterval(tpTimer); tpPlaying = false; }
      updateTpPos();
    }, Math.round(3000 / parseFloat(tpSpeed.value)));
  });
  $('tpPause').addEventListener('click', function() { tpPaused = !tpPaused; });
  $('tpReset').addEventListener('click', function() {
    tpPlaying = false; tpPaused = false; tpPos = 0;
    if (tpTimer) clearInterval(tpTimer);
    updateTpPos();
  });
  tpSpeed.addEventListener('input', function() {
    $('tpSpeedLabel').textContent = this.value + 'x';
    if (tpPlaying) {
      if (tpTimer) clearInterval(tpTimer);
      tpTimer = setInterval(function() {
        if (tpPaused) return;
        tpPos++;
        if (tpPos >= state.teleprompter.length) { tpPos = 0; clearInterval(tpTimer); tpPlaying = false; }
        updateTpPos();
      }, Math.round(3000 / parseFloat(this.value)));
    }
  });
  tpFontSize.addEventListener('input', function() {
    $('tpFontSizeLabel').textContent = this.value + 'px';
    tpText.querySelectorAll('.tp-dialogue').forEach(function(el) { el.style.fontSize = this.value + 'px'; }.bind(this));
  });
  document.addEventListener('keydown', function(e) {
    if (document.querySelector('.tab.active[data-tab="teleprompter"]')) {
      if (e.code === 'Space') { e.preventDefault(); $('tpPause').click(); }
      if (e.code === 'ArrowUp') { tpSpeed.value = Math.min(3, parseFloat(tpSpeed.value) + 0.25).toString(); tpSpeed.dispatchEvent(new Event('input')); }
      if (e.code === 'ArrowDown') { tpSpeed.value = Math.max(0.5, parseFloat(tpSpeed.value) - 0.25).toString(); tpSpeed.dispatchEvent(new Event('input')); }
    }
  });

  // Resources
  function renderResources() {
    var day = state.shootingDay;
    $('castBody').innerHTML = (day.castList||[]).map(function(c, i) {
      return '<tr><td contenteditable="true" data-field="name">' + escHtml(c.name) + '</td>' +
        '<td contenteditable="true" data-field="role">' + escHtml(c.role) + '</td>' +
        '<td contenteditable="true" data-field="arrivalTime">' + escHtml(c.arrivalTime) + '</td>' +
        '<td contenteditable="true" data-field="contact">' + escHtml(c.contact) + '</td>' +
        '<td contenteditable="true" data-field="notes">' + escHtml(c.notes) + '</td>' +
        '<td><button class="btn-delete" data-idx="' + i + '">✕</button></td></tr>';
    }).join('');
    $('equipBody').innerHTML = (day.equipmentList||[]).map(function(e, i) {
      return '<tr><td contenteditable="true" data-field="name">' + escHtml(e.name) + '</td>' +
        '<td contenteditable="true" data-field="quantity">' + e.quantity + '</td>' +
        '<td contenteditable="true" data-field="purpose">' + escHtml(e.purpose) + '</td>' +
        '<td contenteditable="true" data-field="responsible">' + escHtml(e.responsible) + '</td>' +
        '<td contenteditable="true" data-field="cost">' + e.cost + '</td>' +
        '<td><button class="btn-delete" data-idx="' + i + '">✕</button></td></tr>';
    }).join('');
  }
  $('btnAddCast').addEventListener('click', function() {
    state.shootingDay.castList.push({ id: Date.now().toString(36), name: '', role: '', arrivalTime: '', contact: '', notes: '' });
    renderResources();
  });
  $('btnAddEquip').addEventListener('click', function() {
    state.shootingDay.equipmentList.push({ id: Date.now().toString(36), name: '', quantity: 1, purpose: '', responsible: '', cost: 0 });
    renderResources();
  });

  // Timeline
  function renderTimeline(blocks) {
    var el = $('scheduleTimeline');
    if (!blocks || blocks.length === 0) { el.innerHTML = '<div class="timeline-empty">暂无日程</div>'; return; }
    el.innerHTML = blocks.map(function(b) {
      return '<div class="timeline-block"><div class="block-header"><span class="block-time">' + b.timeSlot + '</span><span class="block-scene">【场次' + b.blockNo + '】' + escHtml(b.sceneName) + '</span><span class="block-meta">' + (b.shots?b.shots.length:0) + '镜头 · ' + b.estimatedDuration + 'min</span></div>' +
        (b.castNeeded.length ? '<div class="block-meta">👤 ' + b.castNeeded.join(',') + '</div>' : '') +
        (b.equipmentNeeded.length ? '<div class="block-meta">📦 ' + b.equipmentNeeded.join(',') + '</div>' : '') +
        (b.notes ? '<div class="block-meta">📝 ' + escHtml(b.notes) + '</div>' : '') + '</div>';
    }).join('');
  }

  // Export buttons
  $('btnExportMarkdown').addEventListener('click', function() { vscode.postMessage({ type: 'exportMarkdown', data: getAppState() }); });
  $('btnExportCSV').addEventListener('click', function() { vscode.postMessage({ type: 'exportCSV', data: getAppState() }); });
  $('btnExportTeleprompter').addEventListener('click', function() { vscode.postMessage({ type: 'exportTeleprompter', entries: state.teleprompter, lang: state.lang }); });
  $('btnExportShootingList').addEventListener('click', function() { vscode.postMessage({ type: 'exportShootingList', groups: state.shootingGroups, props: state.propsChecklist }); });
  $('btnExportHostCards').addEventListener('click', function() { vscode.postMessage({ type: 'exportHostCards', shots: state.shots }); });
  $('btnExportFeishu').addEventListener('click', function() { vscode.postMessage({ type: 'exportFeishu', data: getAppState() }); });

  // Navigation helpers
  $('btnShowCategory').addEventListener('click', function() { document.querySelector('.tab[data-tab="category"]').click(); });
  $('btnSuggestScheduleV2').addEventListener('click', function() {
    if (state.shots.length === 0) { alert('请先生成镜头'); return; }
    vscode.postMessage({ type: 'suggestSequence', shots: state.shots });
    document.querySelector('.tab[data-tab="checklist"]').click();
  });

  // Settings
  $('btnSettings').addEventListener('click', function() { $('settingsModal').classList.remove('hidden'); });
  $('btnCloseSettings').addEventListener('click', function() { $('settingsModal').classList.add('hidden'); });
  $('btnSaveApiKey').addEventListener('click', function() {
    var key = $('apiKeyInput').value.trim();
    if (key) vscode.postMessage({ type: 'setApiKey', apiKey: key });
    $('settingsModal').classList.add('hidden');
  });

  // Message handler
  window.addEventListener('message', function(event) {
    var msg = event.data;
    switch (msg.type) {
      case 'generateV2Result':
        loadingInd.classList.add('hidden'); btnGenerateV2.disabled = false;
        state.shots = msg.shots;
        state.propsChecklist = { byShot: msg.props, byCategory: {}, totalNeeded: {} };
        state.teleprompter = msg.teleprompter;
        renderShotTable(state.shots); renderCatTable(state.shots);
        renderTeleprompter(state.teleprompter);
        $('headerSubtitle').textContent = msg.summary;
        vscode.postMessage({ type: 'suggestSequence', shots: msg.shots });
        document.querySelector('.tab[data-tab="shots"]').click();
        break;
      case 'generateResult':
        loadingInd.classList.add('hidden'); btnGenerateV2.disabled = false;
        state.shots = msg.shots;
        renderShotTable(state.shots); renderCatTable(state.shots);
        $('headerSubtitle').textContent = msg.summary;
        document.querySelector('.tab[data-tab="shots"]').click();
        break;
      case 'analyzeVenueResult':
        state.venueAnalysis = msg.analysis;
        var ve = $('venueAnalysisResult');
        ve.classList.remove('hidden');
        ve.querySelector('.analysis-content').textContent = '💡 光线: ' + msg.analysis.lighting + '\\n📐 布局: ' + msg.analysis.layout + '\\n🎥 推荐机位: ' + msg.analysis.shootingPositions.join(', ');
        break;
      case 'analyzeProductResult':
        state.productAnalysis = msg.analysis;
        var pe = $('productAnalysisResult');
        pe.classList.remove('hidden');
        pe.querySelector('.analysis-content').textContent = '📐 关键角度: ' + msg.analysis.keyAngles.join(', ') + '\\n✨ 功能点: ' + msg.analysis.features.join(', ') + '\\n🎬 建议镜头: ' + msg.analysis.suggestedShots.join(', ');
        break;
      case 'suggestSequenceResult':
        state.shootingGroups = msg.groups;
        renderShootingGroups(msg.groups);
        break;
      case 'teleprompterResult':
        state.teleprompter = msg.entries;
        renderTeleprompter(msg.entries);
        break;
      case 'scheduleResult':
        state.shootingDay = msg.day;
        renderTimeline(state.shootingDay.blocks);
        renderResources();
        document.querySelector('.tab[data-tab="schedule"]').click();
        break;
      case 'error':
        loadingInd.classList.add('hidden'); btnGenerateV2.disabled = false;
        alert('❌ ' + msg.message);
        break;
      case 'showMessage':
        alert(msg.text);
        break;
    }
  });

  // Init
  renderResources();
})();
`;
  }

  private dispose() {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
