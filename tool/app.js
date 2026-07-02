const $ = (id) => document.getElementById(id);

const provider = $('provider');
const authMode = $('authMode');
const baseURL = $('baseURL');
const model = $('model');
const apiKey = $('apiKey');
const apiSummary = $('apiSummary');
const apiSettings = $('apiSettings');
const openApiBtn = $('openApiBtn');
const scriptInput = $('scriptInput');
const scriptStats = $('scriptStats');
const videoType = $('videoType');
const maxShots = $('maxShots');
const audience = $('audience');
const goal = $('goal');
const styleTone = $('styleTone');
const mustHave = $('mustHave');
const direction = $('direction');
const batchMode = $('batchMode');
const batchList = $('batchList');
const fileUpload = $('fileUpload');
const generateBtn = $('generateBtn');
const stopBatchBtn = $('stopBatchBtn');
const statusText = $('statusText');
const summary = $('summary');
const shotBody = $('shotBody');
const shootingGroups = $('shootingGroups');
const propsList = $('propsList');
const dayPlan = $('dayPlan');
const dayPlanSummary = $('dayPlanSummary');
const teleprompterText = $('teleprompterText');
const hostDirection = $('hostDirection');

const TABLE_COLUMNS = [
  ['scriptTitle', '脚本名称'],
  ['scriptText', '脚本'],
  ['shotNo', '镜头'],
  ['status', '状态'],
  ['duration', '时长(秒)'],
  ['sceneName', '场景'],
  ['actorMakeup', '演员妆造'],
  ['wardrobeProps', '服化道'],
  ['shotType', '景别'],
  ['cameraMove', '运镜'],
  ['visual', '画面'],
  ['actionExpression', '动作神情'],
  ['dialogue', '口播稿'],
  ['subtitle', '字幕'],
  ['storyboardImage', '分镜图'],
  ['storyboardImageUrl', '分镜图链接'],
  ['videoUrl', '视频链接'],
];

let currentResult = null;
let batchTasks = [];
let activeTaskIndex = -1;
let stopBatch = false;
let tpIndex = 0;
let tpTimer = null;

const stored = JSON.parse(localStorage.getItem('shotboard_tool_settings') || '{}');
provider.value = stored.provider || 'openai';
authMode.value = stored.authMode || 'bearer';
baseURL.value = stored.baseURL || '';
model.value = stored.model || 'claude-sonnet-4-20250514';
videoType.value = stored.videoType || 'product';
maxShots.value = stored.maxShots || 30;
batchMode.checked = Boolean(stored.batchMode);

function saveSettings() {
  localStorage.setItem('shotboard_tool_settings', JSON.stringify({
    provider: provider.value,
    authMode: authMode.value,
    baseURL: baseURL.value,
    model: model.value,
    videoType: videoType.value,
    maxShots: maxShots.value,
    batchMode: batchMode.checked,
  }));
}

function updateApiSummary() {
  const hasKey = Boolean(apiKey.value.trim());
  const hasUrl = Boolean(baseURL.value.trim());
  const configured = hasKey && (hasUrl || provider.value === 'anthropic');
  apiSummary.textContent = configured
    ? `${provider.value === 'openai' ? 'OpenAI兼容' : 'Anthropic兼容'} · 已配置`
    : hasUrl ? '缺少 API Key' : '未配置';
  apiSummary.classList.toggle('ready', configured);
  apiSummary.classList.toggle('warn', !configured && (hasKey || hasUrl));
}

function revealApiSettings(message) {
  if (apiSettings) {
    apiSettings.open = true;
    apiSettings.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (message) {
    statusText.textContent = message;
  }
}

function isLikelyApiConfigError(message) {
  return /API Key|401|403|Unauthorized|Forbidden|invalid_api_key|鉴权|认证|权限|未配置|Base URL|ENOTFOUND|fetch failed/i.test(message || '');
}

function syncProviderDefaults() {
  if (provider.value === 'openai') {
    authMode.value = 'bearer';
    if (!model.value) model.value = 'claude-sonnet-4-20250514';
  } else {
    authMode.value = 'x-api-key';
    if (!model.value || model.value.startsWith('gpt-')) {
      model.value = 'claude-sonnet-4-20250514';
    }
  }
  saveSettings();
  updateApiSummary();
}

function creativeBrief() {
  const lines = [];
  if (audience.value.trim()) lines.push(`目标人群：${audience.value.trim()}`);
  if (goal.value.trim()) lines.push(`拍摄目标：${goal.value.trim()}`);
  if (styleTone.value.trim()) lines.push(`画面风格：${styleTone.value.trim()}`);
  if (mustHave.value.trim()) lines.push(`必须保留：${mustHave.value.trim()}`);
  if (direction.value.trim()) lines.push(`补充要求：${direction.value.trim()}`);
  return lines.join('\n');
}

function detectScriptMode(script) {
  const text = script || '';
  const hasTableWords = /镜头|景别|运镜|分镜|画面|口播|时长|状态|视频链接/.test(text);
  const hasRows = text.split(/\r?\n/).filter((line) => line.trim()).length >= 4;
  const hasNumbered = /(^|\n)\s*(\d+|镜头\s*\d+)[.、\s]/.test(text);
  if (hasTableWords && (hasRows || hasNumbered)) {
    return '## 输入类型识别\n用户粘贴的是已有拍摄脚本/分镜表。请保留原有镜头顺序和信息，只补齐缺失字段，整理为标准执行表。';
  }
  return '## 输入类型识别\n用户粘贴的是完整口播稿或普通脚本。请自动理解结构，拆成可拍摄的分镜执行表、拍摄清单和提词器。';
}

function buildPromptScript(script, title = '') {
  const cleanScript = script.trim();
  const brief = creativeBrief();
  const titleBlock = title ? `## 本次脚本名称\n${title}\n\n## 批量隔离规则\n本次只处理“${title}”这一条脚本。禁止合并、引用、续写其它脚本；输出中所有镜头都必须属于该脚本。\n\n` : '';
  const wrapped = `${titleBlock}${detectScriptMode(cleanScript)}\n\n${cleanScript}`;
  return brief ? `${wrapped}\n\n## 创作补充要求\n${brief}` : wrapped;
}

function applyScriptTitle(result, title) {
  const scriptTitle = title || result?.scriptTitle || '';
  if (!result || !scriptTitle) return result;
  result.scriptTitle = scriptTitle;
  result.shots = (result.shots || []).map((shot) => ({
    ...shot,
    scriptTitle: shot.scriptTitle || scriptTitle,
  }));
  return result;
}

function titleFromCurrentInput() {
  const first = (scriptInput.value.trim().split(/\r?\n/)[0] || '').trim();
  const heading = first.match(/^#{1,6}\s*(.+)$/) || first.match(/^脚本(?:名称)?[:：]\s*(.+)$/);
  return heading ? heading[1].trim() : '';
}

function parseBatchScripts() {
  const raw = scriptInput.value.trim();
  if (!raw) return [];

  let parts = raw
    .split(/\n\s*---+\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 1) {
    const headingMatches = [...raw.matchAll(/^#{1,6}\s+(.+)$/gm)];
    if (headingMatches.length > 1) {
      parts = headingMatches.map((match, index) => {
        const start = match.index || 0;
        const end = headingMatches[index + 1]?.index ?? raw.length;
        return raw.slice(start, end).trim();
      }).filter(Boolean);
    }
  }

  const chunks = parts.length > 1 ? parts : [raw];
  return chunks.map((chunk, index) => {
    const lines = chunk.split(/\r?\n/);
    let title = `脚本 ${index + 1}`;
    let script = chunk;
    const first = lines[0]?.trim() || '';
    const heading = first.match(/^#{1,6}\s*(.+)$/) || first.match(/^脚本(?:名称)?[:：]\s*(.+)$/);
    if (heading) {
      title = heading[1].trim() || title;
      script = lines.slice(1).join('\n').trim() || chunk;
    }
    return {
      id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      script,
      status: 'waiting',
      result: null,
      error: '',
    };
  });
}

function updateStats() {
  const scripts = parseBatchScripts();
  const count = scriptInput.value.trim().replace(/\s/g, '').length;
  scriptStats.textContent = batchMode.checked || scripts.length > 1
    ? `${scripts.length} 个脚本 · ${count} 字${creativeBrief() ? ' · 已加入补充要求' : ''}`
    : `${count} 字${creativeBrief() ? ' · 已加入补充要求' : ''}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function renderBatchList() {
  batchList.classList.toggle('hidden', !batchMode.checked || batchTasks.length === 0);
  if (!batchMode.checked || batchTasks.length === 0) {
    batchList.innerHTML = '';
    return;
  }
  const statusLabel = { waiting: '等待', running: '生成中', done: '完成', error: '失败' };
  batchList.innerHTML = batchTasks.map((task, index) => `
    <div class="batch-item ${index === activeTaskIndex ? 'active' : ''}" data-index="${index}">
      <div>
        <div class="batch-title">${escapeHtml(task.title)}</div>
        <div class="batch-meta ${task.status === 'error' ? 'error' : ''}">${escapeHtml(task.error || task.script.slice(0, 54))}${!task.error && task.script.length > 54 ? '...' : ''}</div>
      </div>
      <span class="batch-state ${escapeAttr(task.status)}">${statusLabel[task.status] || task.status}</span>
    </div>
  `).join('');
  batchList.querySelectorAll('.batch-item').forEach((item) => {
    item.addEventListener('click', () => selectTask(Number(item.dataset.index)));
  });
}

function selectTask(index) {
  const task = batchTasks[index];
  if (!task) return;
  activeTaskIndex = index;
  renderBatchList();
  if (task.result) {
    render(task.result, task.title);
  } else {
    summary.textContent = task.error || `${task.title} ${task.status === 'running' ? '生成中' : '还没有生成结果'}`;
  }
}

function render(result, title = '') {
  applyScriptTitle(result, title);
  currentResult = result;
  summary.textContent = `${title ? `${title}｜` : ''}${result.summary || `共 ${result.shots?.length || 0} 个镜头`}`;
  if (!result.shots || result.shots.length === 0) {
    shotBody.innerHTML = `<tr><td colspan="${TABLE_COLUMNS.length}" class="empty">没有生成镜头</td></tr>`;
    renderShootingList(result);
    renderTeleprompter([]);
    return;
  }
  shotBody.innerHTML = result.shots.map((shot) => `
    <tr>
      <td>${escapeHtml(shot.scriptTitle || result.scriptTitle || title || '')}</td>
      <td>${escapeHtml(shot.scriptText || shot.dialogue || shot.visual)}</td>
      <td>镜头 ${escapeHtml(shot.shotNo)}</td>
      <td><span class="tag">${escapeHtml(shot.status || '待拍摄')}</span></td>
      <td>${escapeHtml(shot.duration)}</td>
      <td>${escapeHtml(shot.sceneName)}</td>
      <td>${escapeHtml(shot.actorMakeup || '')}</td>
      <td>${escapeHtml(shot.wardrobeProps || '')}</td>
      <td>${escapeHtml(shot.shotType)}</td>
      <td>${escapeHtml(shot.cameraMove)}</td>
      <td>${escapeHtml(shot.visual)}</td>
      <td>${escapeHtml(shot.actionExpression || '')}</td>
      <td>${escapeHtml(shot.dialogue)}</td>
      <td>${escapeHtml(shot.subtitle || '')}</td>
      <td>${escapeHtml(shot.storyboardImage || '')}</td>
      <td>${shot.storyboardImageUrl ? `<a href="${escapeAttr(shot.storyboardImageUrl)}" target="_blank">打开</a>` : ''}</td>
      <td>${shot.videoUrl ? `<a href="${escapeAttr(shot.videoUrl)}" target="_blank">打开</a>` : ''}</td>
    </tr>
  `).join('');
  renderShootingList(result);
  renderTeleprompter(result.teleprompter || []);
  renderDayPlan();
}

function buildGroups(shots) {
  const order = ['empty', 'product', 'broll', 'talking', 'other'];
  const names = { empty: '空镜拍摄', product: '产品展示', broll: 'B-roll 补充画面', talking: '口播录制', other: '其他镜头' };
  const tips = {
    empty: '同场景空镜集中拍，先拿环境和转场素材。',
    product: '同场景产品镜头集中拍，产品、灯光、机位不用反复重摆。',
    broll: '同场景 B-roll 集中补，方便后期遮挡剪辑。',
    talking: '口播最后集中拍，主播状态、妆发和收音更稳定。',
    other: '同场景杂项镜头穿插补齐。',
  };
  const groups = [];
  for (const category of order) {
    const byScene = new Map();
    for (const shot of shots.filter((item) => item.category === category)) {
      const scene = shot.sceneName || '未指定场景';
      if (!byScene.has(scene)) byScene.set(scene, []);
      byScene.get(scene).push(shot);
    }
    for (const [scene, groupShots] of byScene.entries()) {
      const cameraMoves = [...new Set(groupShots.map((shot) => shot.cameraMove).filter(Boolean))].join('、') || '按现场';
      groups.push({
        groupId: groups.length + 1,
        name: `${scene}｜${names[category]}`,
        category,
        shots: groupShots,
        estimatedMinutes: Math.max(5, Math.ceil(groupShots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0) * 6 / 60)),
        note: `${tips[category]}建议一起拍：镜头 ${groupShots.map((shot) => shot.shotNo).join('、')}。运镜：${cameraMoves}。妆造：${summarizeField(groupShots, 'actorMakeup') || '按镜头表'}。服化道：${summarizeField(groupShots, 'wardrobeProps') || '按镜头表'}。`,
      });
    }
  }
  return groups;
}

function summarizeField(shots, key) {
  return [...new Set(shots.map((shot) => shot[key]).filter(Boolean))].slice(0, 4).join('；');
}

function shotRef(shot) {
  return `${shot.scriptTitle || '未命名脚本'}｜镜头 ${shot.shotNo}`;
}

function performanceMode(shot) {
  const text = [shot.category, shot.shotType, shot.visual, shot.actionExpression, shot.dialogue].filter(Boolean).join(' ');
  if (!shot.dialogue) return '无台词画面';
  if (/背影|手部|远景|空镜|产品|B-roll|不露脸|侧脸|蒙太奇|特写/.test(text) && !/正脸|对口型|面对镜头/.test(text)) {
    return '画面先拍，台词后配';
  }
  if (/正脸|面对镜头|口播|对口型|同期/.test(text)) return '同期口播';
  return '同期/后配现场定';
}

function aiReplacementAdvice(shot) {
  const text = [shot.category, shot.shotType, shot.visual, shot.actionExpression, shot.wardrobeProps].filter(Boolean).join(' ');
  if (/正脸|口播|对口型|手持产品|真实试用|细节功效|包装文字|LOGO/.test(text)) {
    return '实拍优先，不建议AI替换';
  }
  if (/空镜|远景|背影|侧脸|不露脸|环境|氛围|B-roll|服装展示/.test(text)) {
    return '可拍空景/服装参考，后期AI替换待评估';
  }
  if (shot.category === 'empty' || shot.category === 'broll') return 'AI/库存素材可替换候选';
  return 'AI替换待确认';
}

function renderShootingList(result) {
  const groups = result.shootingGroups || buildGroups(result.shots || []);
  shootingGroups.innerHTML = groups.length ? groups.map((group) => `
    <div class="shooting-group group-${escapeAttr(group.category)}">
      <div class="group-title">
        <span>第 ${group.groupId} 组：${escapeHtml(group.name)}</span>
        <span>约 ${escapeHtml(group.estimatedMinutes)} 分钟</span>
      </div>
      <div class="group-note">${escapeHtml(group.note || '')}</div>
      <div class="shot-chip-list">
        ${(group.shots || []).map((shot) => `<span class="shot-chip">${escapeHtml(shot.scriptTitle || result.scriptTitle || '')}｜镜头 ${escapeHtml(shot.shotNo)} · ${escapeHtml(shot.shotType || shot.category)}</span>`).join('')}
      </div>
      <div class="day-shot-list">
        ${(group.shots || []).map((shot) => `
          <div class="day-shot">
            <strong>${escapeHtml(shot.scriptTitle || result.scriptTitle || '')}</strong>
            ｜镜头 ${escapeHtml(shot.shotNo)}
            ｜${escapeHtml(shot.duration || '')}s
            ${shot.sceneName ? `｜场景：${escapeHtml(shot.sceneName)}` : ''}
            ${shot.visual ? `｜画面：${escapeHtml(shot.visual)}` : ''}
            ${shot.dialogue ? `｜口播：${escapeHtml(shot.dialogue)}` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('') : '<div class="empty-block">没有可用的拍摄分组。</div>';

  const checklist = result.propsChecklist || { byShot: result.props || [], totalNeeded: {} };
  const totalNeeded = checklist.totalNeeded || {};
  const propRows = Object.keys(totalNeeded).map((name) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(totalNeeded[name])}</td><td>待准备</td></tr>`).join('');
  propsList.innerHTML = propRows
    ? `<table><thead><tr><th>道具</th><th>数量</th><th>状态</th></tr></thead><tbody>${propRows}</tbody></table>`
    : '<div class="empty-block">没有识别到道具。可以在分镜表里手动补充。</div>';
}

function planningResults() {
  const batch = successfulBatchResults();
  if (batch.length) {
    return batch.map((task) => ({
      title: task.title,
      result: applyScriptTitle(task.result, task.title),
    }));
  }
  return currentResult ? [{ title: currentResult.scriptTitle || titleFromCurrentInput() || '当前脚本', result: currentResult }] : [];
}

function buildDayPlan(results) {
  const categoryNames = { empty: '空镜', product: '产品展示', broll: 'B-roll', talking: '口播', other: '其他' };
  const phaseNames = {
    setup: '无主播素材',
    talent: '主播口播',
    pickup: '补拍/其他',
  };
  const shots = [];
  for (const item of results) {
    const title = item.title || item.result?.scriptTitle || '未命名脚本';
    for (const shot of item.result?.shots || []) {
      shots.push({ ...shot, scriptTitle: shot.scriptTitle || title });
    }
  }

  const grouped = new Map();
  for (const shot of shots) {
    const category = shot.category || 'other';
    const scene = shot.sceneName || '待确认场景';
    const actorMakeup = shot.actorMakeup || (category === 'talking' ? '妆造待确认' : '不出镜');
    const wardrobeProps = shot.wardrobeProps || '服化道待确认';
    const phase = category === 'talking' ? 'talent' : (category === 'other' ? 'pickup' : 'setup');
    const key = category === 'talking'
      ? [phase, scene, actorMakeup, wardrobeProps].join('|')
      : [phase, scene, category].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, { phase, scene, category, actorMakeup, wardrobeProps, shots: [] });
    }
    grouped.get(key).shots.push(shot);
  }

  const phaseOrder = { setup: 1, talent: 2, pickup: 3 };
  const categoryOrder = { empty: 1, product: 2, broll: 3, talking: 4, other: 5 };
  const groups = [...grouped.values()].sort((a, b) => {
    if (phaseOrder[a.phase] !== phaseOrder[b.phase]) return phaseOrder[a.phase] - phaseOrder[b.phase];
    if (a.scene !== b.scene) return a.scene.localeCompare(b.scene, 'zh-Hans-CN');
    return (categoryOrder[a.category] || 9) - (categoryOrder[b.category] || 9);
  }).map((group, index) => {
    const groupShots = group.shots;
    const shotType = summarizeField(groupShots, 'shotType') || '按镜头表';
    const cameraMove = summarizeField(groupShots, 'cameraMove') || '按现场';
    const scriptNames = [...new Set(groupShots.map((shot) => shot.scriptTitle).filter(Boolean))].join('、') || '未命名脚本';
    const isTalent = group.phase === 'talent';
    const baseMinutes = groupShots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
    const shotTypes = summarizeField(groupShots, 'shotType') || '按镜头表';
    const wardrobePlan = isTalent
      ? '同景别不同服装：先锁机位和灯光，当前服装下把所有脚本口播/动作一次拍完，再换下一套；不要一条脚本换一次衣服。'
      : '同景别不同服装/道具：先拍空景和固定机位，再按服装或道具单向切换，避免来回恢复现场。';
    const performancePlan = isTalent
      ? '表演和台词不必总是同步：正脸口播同期录；背影、手部、产品、情绪画面可先拍表演画面，再统一录旁白/补口播。'
      : '无台词画面先拍，后期用口播、字幕或音效补信息。';
    const aiPlan = 'AI替换只作为后期候选：空景、远景、背影、服装参考可评估；正脸口播、手持产品、包装文字、真实试用优先实拍。';
    return {
      groupId: index + 1,
      phase: group.phase,
      category: group.category,
      name: `${phaseNames[group.phase]}｜${group.scene}｜${isTalent ? '同妆同衣连续口播' : categoryNames[group.category]}`,
      shots: groupShots,
      estimatedMinutes: Math.max(isTalent ? 12 : 8, Math.ceil(baseMinutes * (isTalent ? 4 : 6) / 60) + (isTalent ? 8 : 5)),
      note: isTalent
        ? [
            `这组不要一个镜头一个镜头拍。主播同一妆造/服装/场景下，把涉及脚本的口播按脚本连续录完，后期再切分并用产品/B-roll 遮跳切。`,
            `妆造：${group.actorMakeup}。服化道：${group.wardrobeProps}。`,
            `景别：${shotTypes}。运镜：${cameraMove}。`,
            `${wardrobePlan}`,
            `${performancePlan}`,
            `${aiPlan}`,
            `涉及脚本：${scriptNames}。`,
            `现场沟通重点：提词器按脚本顺序滚；每条脚本开录前报脚本名，错句从上一句重来，不必卸妆换衣。`,
          ].join('')
        : [
            `先拍这组，主播不用等待；同场景集中完成，减少换场、换灯、换机位。`,
            `景别：${shotTypes}。运镜：${cameraMove}。`,
            `${wardrobePlan}`,
            `${performancePlan}`,
            `${aiPlan}`,
            `服化道：${summarizeField(groupShots, 'wardrobeProps') || '按镜头表'}。`,
            `涉及脚本：${scriptNames}。`,
          ].join(''),
    };
  });
  const totalMinutes = groups.reduce((sum, group) => sum + group.estimatedMinutes, 0);
  return { groups, totalMinutes, shots, pendingItems: collectPendingItems(shots) };
}

function collectPendingItems(shots) {
  const checks = [
    ['sceneName', '场景'],
    ['actorMakeup', '演员妆造'],
    ['wardrobeProps', '服化道'],
    ['shotType', '景别'],
    ['cameraMove', '运镜'],
    ['visual', '画面'],
  ];
  const items = [];
  for (const shot of shots) {
    for (const [key, label] of checks) {
      const value = String(shot[key] || '').trim();
      if (!value || /待确认|不确定|未确认/.test(value)) {
        items.push(`${shot.scriptTitle || '未命名脚本'}｜镜头 ${shot.shotNo}｜${label}待确认`);
      }
    }
    if ((shot.category === 'talking' || shot.dialogue) && !String(shot.dialogue || '').trim()) {
      items.push(`${shot.scriptTitle || '未命名脚本'}｜镜头 ${shot.shotNo}｜口播稿待确认`);
    }
  }
  return [...new Set(items)];
}

function renderDayPlan() {
  if (!dayPlan || !dayPlanSummary) return;
  const results = planningResults();
  const plan = buildDayPlan(results);
  if (!plan.groups.length) {
    dayPlanSummary.textContent = '批量生成后，会把所有脚本合并成一天的拍摄顺序。';
    dayPlan.innerHTML = '<div class="empty-block">这里会按场景、镜头类型、妆造和服化道合并镜头，告诉你十几条脚本当天怎么拍最省事。</div>';
    return;
  }
  dayPlanSummary.textContent = `共 ${results.length} 条脚本，${plan.shots.length} 个镜头，现场拍摄预估约 ${plan.totalMinutes} 分钟。`;
  const pendingHtml = plan.pendingItems.length
    ? `<div class="pending-box"><h3>待确认项</h3>${plan.pendingItems.map((item) => `<div class="pending-item">${escapeHtml(item)}</div>`).join('')}</div>`
    : '<div class="pending-box ready"><h3>待确认项</h3><div class="pending-item">暂无明显待确认项。</div></div>';
  dayPlan.innerHTML = `${pendingHtml}${plan.groups.map((group) => `
    <div class="shooting-group group-${escapeAttr(group.category)}">
      <div class="group-title">
        <span>第 ${group.groupId} 组：${escapeHtml(group.name)}</span>
        <span>约 ${escapeHtml(group.estimatedMinutes)} 分钟</span>
      </div>
      <div class="group-note">${escapeHtml(group.note)}</div>
      <div class="day-shot-list">
        ${group.shots.map((shot) => `
          <div class="day-shot">
            <strong>${escapeHtml(shotRef(shot))}</strong>
            ｜${escapeHtml(shot.shotType || shot.category || '')}
            ｜${escapeHtml(shot.duration || '')}s
            ｜<span class="method-tag">${escapeHtml(performanceMode(shot))}</span>
            ｜<span class="method-tag">${escapeHtml(aiReplacementAdvice(shot))}</span>
            ${group.phase === 'talent' && shot.dialogue ? `｜口播：${escapeHtml(shot.dialogue)}` : ''}
            ${shot.visual ? `｜${escapeHtml(shot.visual)}` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('')}`;
}

function renderTeleprompter(entries) {
  tpIndex = 0;
  clearInterval(tpTimer);
  tpTimer = null;
  if (!entries.length) {
    teleprompterText.innerHTML = '<div class="empty-block">没有口播内容。</div>';
    renderHostDirection(null);
    return;
  }
  teleprompterText.innerHTML = entries.map((entry, index) => `
    <div class="tp-line ${index === 0 ? 'active' : ''}" data-index="${index}">
      <div class="tp-shot">镜头 ${escapeHtml(entry.shotNo)} · ${escapeHtml(entry.duration)} 秒</div>
      <div class="tp-dialogue">${escapeHtml(entry.dialogue)}</div>
    </div>
  `).join('');
  teleprompterText.querySelectorAll('.tp-line').forEach((line) => {
    line.addEventListener('click', () => setTeleprompterIndex(Number(line.dataset.index)));
  });
  renderHostDirection(entries[0]?.hostDirection);
}

function setTeleprompterIndex(index) {
  const entries = currentResult?.teleprompter || [];
  if (!entries.length) return;
  tpIndex = Math.max(0, Math.min(index, entries.length - 1));
  teleprompterText.querySelectorAll('.tp-line').forEach((line, lineIndex) => {
    line.classList.toggle('active', lineIndex === tpIndex);
    if (lineIndex === tpIndex) line.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  renderHostDirection(entries[tpIndex]?.hostDirection);
}

function renderHostDirection(directionData) {
  if (!directionData) {
    hostDirection.innerHTML = '<h3>主播指导</h3><p>当前口播没有额外表演指导。</p>';
    return;
  }
  hostDirection.innerHTML = `
    <h3>主播指导</h3>
    <dl>
      <dt>语气</dt><dd>${escapeHtml(directionData.tone || '')}</dd>
      <dt>表情</dt><dd>${escapeHtml(directionData.expression || '')}</dd>
      <dt>手势</dt><dd>${escapeHtml(directionData.gesture || '')}</dd>
      <dt>眼神</dt><dd>${escapeHtml(directionData.eyeDirection || '')}</dd>
      <dt>体态</dt><dd>${escapeHtml(directionData.posture || '')}</dd>
      <dt>走位</dt><dd>${escapeHtml(directionData.movement || '')}</dd>
      <dt>重音</dt><dd>${escapeHtml((directionData.emphasisWords || []).join('、'))}</dd>
      <dt>停顿</dt><dd>${directionData.breathingPoint ? '需要换气/停顿' : '正常衔接'}</dd>
    </dl>
  `;
}

async function callGenerate(script, title = '') {
  if (!apiKey.value.trim()) {
    throw new Error('接口未配置：请点击“接口设置”，填写 API Key。');
  }
  if (provider.value === 'openai' && !baseURL.value.trim() && model.value.startsWith('claude-')) {
    throw new Error('接口设置可能不完整：OpenAI 兼容模式下使用 Claude 模型时，请填写中转站 API Base URL。');
  }
  const response = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: provider.value,
      authMode: authMode.value,
      baseURL: baseURL.value,
      model: model.value,
      apiKey: apiKey.value,
      request: {
        script: buildPromptScript(script, title),
        videoType: videoType.value,
        lang: 'zh',
        maxShots: Number(maxShots.value || 30),
        mediaInputs: [],
      },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || '生成失败');
  return data;
}

async function generateSingle() {
  const script = scriptInput.value.trim();
  if (!script) {
    alert('请先输入脚本。');
    return;
  }
  saveSettings();
  generateBtn.disabled = true;
  statusText.textContent = '生成中...';
  summary.textContent = '正在请求 API';
  try {
    const data = applyScriptTitle(await callGenerate(script, titleFromCurrentInput()), titleFromCurrentInput());
    batchTasks = [];
    activeTaskIndex = -1;
    renderBatchList();
    render(data);
    statusText.textContent = '已生成';
  } catch (error) {
    const message = error.message || String(error);
    statusText.textContent = '生成失败';
    summary.textContent = message;
    if (isLikelyApiConfigError(message)) revealApiSettings('接口配置需要检查');
  } finally {
    generateBtn.disabled = false;
  }
}

async function generateBatch() {
  batchTasks = parseBatchScripts();
  if (!batchTasks.length) {
    alert('请先输入脚本。多个脚本可以用 --- 分隔。');
    return;
  }
  saveSettings();
  stopBatch = false;
  generateBtn.disabled = true;
  stopBatchBtn.classList.remove('hidden');
  statusText.textContent = `批量生成中 0/${batchTasks.length}`;
  activeTaskIndex = 0;
  renderBatchList();

  for (let index = 0; index < batchTasks.length; index += 1) {
    if (stopBatch) break;
    const task = batchTasks[index];
    task.status = 'running';
    activeTaskIndex = index;
    renderBatchList();
    summary.textContent = `${task.title} 正在生成...`;
    try {
      const result = applyScriptTitle(await callGenerate(task.script, task.title), task.title);
      task.result = result;
      task.status = 'done';
      task.error = '';
      render(result, task.title);
    } catch (error) {
      task.status = 'error';
      task.error = error.message || String(error);
      summary.textContent = `${task.title} 生成失败：${task.error}`;
      if (isLikelyApiConfigError(task.error)) {
        revealApiSettings('接口配置需要检查');
        stopBatch = true;
      }
    }
    statusText.textContent = `批量生成中 ${batchTasks.filter((item) => item.status === 'done').length}/${batchTasks.length}`;
    renderBatchList();
    renderDayPlan();
  }

  generateBtn.disabled = false;
  stopBatchBtn.classList.add('hidden');
  statusText.textContent = stopBatch ? '批量已停止' : `批量完成 ${batchTasks.filter((item) => item.status === 'done').length}/${batchTasks.length}`;
}

function generate() {
  const scripts = parseBatchScripts();
  if (batchMode.checked || scripts.length > 1) {
    if (!batchMode.checked && scripts.length > 1) {
      batchMode.checked = true;
      saveSettings();
      updateStats();
    }
    return generateBatch();
  }
  return generateSingle();
}

function toMarkdown(result = currentResult, title = '') {
  if (!result) return '';
  const headers = TABLE_COLUMNS.map(([, label]) => label);
  const lines = [`# ${title ? `${title} - ` : ''}分镜执行表`, '', result.summary || '', '', `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`];
  for (const shot of result.shots || []) {
    const row = TABLE_COLUMNS.map(([key]) => {
      const value = key === 'shotNo' ? `镜头 ${shot[key]}` : (shot[key] || '');
      return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    });
    lines.push(`| ${row.join(' | ')} |`);
  }
  return lines.join('\n');
}

function csvRowsForResult(result, title = '') {
  applyScriptTitle(result, title);
  return (result.shots || []).map((shot) => {
    const values = [title, ...TABLE_COLUMNS.map(([key]) => (key === 'shotNo' ? `镜头 ${shot[key]}` : (shot[key] || '')))];
    return values.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',');
  });
}

function toCsv(result = currentResult, title = '') {
  if (!result) return '';
  const headers = ['项目', ...TABLE_COLUMNS.map(([, label]) => label)].join(',');
  return [headers, ...csvRowsForResult(result, title)].join('\n');
}

function successfulBatchResults() {
  return batchTasks.filter((task) => task.status === 'done' && task.result);
}

function toBatchCsv() {
  const tasks = successfulBatchResults();
  if (!tasks.length) return currentResult ? toCsv(currentResult) : '';
  const headers = ['项目', ...TABLE_COLUMNS.map(([, label]) => label)].join(',');
  const rows = tasks.flatMap((task) => csvRowsForResult(task.result, task.title));
  return [headers, ...rows].join('\n');
}

function toShootingMarkdown(result = currentResult, title = '') {
  if (!result) return '';
  const groups = result.shootingGroups || buildGroups(result.shots || []);
  const lines = [`# ${title ? `${title} - ` : ''}拍摄清单`, '', result.summary || '', ''];
  for (const group of groups) {
    lines.push(`## 第 ${group.groupId} 组：${group.name}`, `预计：${group.estimatedMinutes} 分钟`, group.note || '', '');
    for (const shot of group.shots || []) {
      lines.push(`- 镜头 ${shot.shotNo}｜${shot.status || '待拍摄'}｜${shot.duration}s｜${shot.shotType}｜${shot.cameraMove}`);
      lines[lines.length - 1] = `- ${shot.scriptTitle || result.scriptTitle || title || '未命名脚本'}｜镜头 ${shot.shotNo}｜${shot.status || '待拍摄'}｜${shot.duration}s｜${shot.shotType}｜${shot.cameraMove}`;
      if (shot.sceneName) lines.push(`  - 场景：${shot.sceneName}`);
      if (shot.actorMakeup) lines.push(`  - 演员妆造：${shot.actorMakeup}`);
      if (shot.wardrobeProps) lines.push(`  - 服化道：${shot.wardrobeProps}`);
      if (shot.visual) lines.push(`  - 画面：${shot.visual}`);
      if (shot.actionExpression) lines.push(`  - 动作神情：${shot.actionExpression}`);
      if (shot.dialogue) lines.push(`  - 口播：${shot.dialogue}`);
      if (shot.subtitle) lines.push(`  - 字幕：${shot.subtitle}`);
    }
    lines.push('');
  }
  const totalNeeded = result.propsChecklist?.totalNeeded || {};
  if (Object.keys(totalNeeded).length) {
    lines.push('## 道具准备', '');
    for (const [name, qty] of Object.entries(totalNeeded)) lines.push(`- ${name} x ${qty}`);
  }
  return lines.join('\n');
}

function toDayPlanMarkdown() {
  const results = planningResults();
  const plan = buildDayPlan(results);
  if (!plan.groups.length) return '';
  const lines = ['# 当天统筹拍摄计划', '', `脚本数：${results.length}`, `镜头数：${plan.shots.length}`, `预估现场拍摄：${plan.totalMinutes} 分钟`, ''];
  lines.push('## 现场原则', '', '- 先拍不需要主播的空镜、产品、B-roll，避免主播带妆等待。', '- 主播同一妆造、同一服装、同一场景的口播连续录完，不按单个镜头碎拍。', '- 每条口播开录前报脚本名，后期按分镜切分。', '');
  lines.push('## 待确认项', '');
  if (plan.pendingItems.length) {
    for (const item of plan.pendingItems) lines.push(`- ${item}`);
  } else {
    lines.push('- 暂无明显待确认项。');
  }
  lines.push('');
  for (const group of plan.groups) {
    lines.push(`## 第 ${group.groupId} 组：${group.name}`, `预计：${group.estimatedMinutes} 分钟`, group.note, '');
    for (const shot of group.shots) {
      lines.push(`- ${shotRef(shot)}｜${shot.status || '待拍摄'}｜${shot.duration}s｜${shot.shotType || ''}｜${shot.cameraMove || ''}`);
      lines.push(`  - 拍法：${performanceMode(shot)}`);
      lines.push(`  - AI/后期：${aiReplacementAdvice(shot)}`);
      if (shot.actorMakeup) lines.push(`  - 演员妆造：${shot.actorMakeup}`);
      if (shot.wardrobeProps) lines.push(`  - 服化道：${shot.wardrobeProps}`);
      if (shot.visual) lines.push(`  - 画面：${shot.visual}`);
      if (shot.dialogue) lines.push(`  - 口播：${shot.dialogue}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function toTeleprompterText(result = currentResult, title = '') {
  if (!result) return '';
  const lines = title ? [`# ${title}`, ''] : [];
  for (const entry of result.teleprompter || []) {
    const d = entry.hostDirection;
    const guide = d ? `（${[d.tone, d.expression, d.gesture, d.movement].filter(Boolean).join(' / ')}）` : '';
    lines.push(`镜头 ${entry.shotNo} [${entry.duration}s]`, guide, entry.dialogue, '');
  }
  return lines.join('\n');
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function itemsToBatchText(items) {
  return (items || []).map((item, index) => {
    const title = item.title || `脚本 ${index + 1}`;
    return `### ${title}\n${item.script || ''}`.trim();
  }).filter(Boolean).join('\n\n---\n\n');
}

async function uploadFile(file) {
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  statusText.textContent = '解析上传文件...';
  try {
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || '上传解析失败');
    const items = data.items || [];
    if (!items.length) throw new Error('没有从文件里识别到脚本内容。');
    scriptInput.value = itemsToBatchText(items);
    batchMode.checked = items.length > 1;
    batchTasks = parseBatchScripts();
    activeTaskIndex = batchTasks.length ? 0 : -1;
    saveSettings();
    updateStats();
  renderBatchList();
  statusText.textContent = `已解析 ${items.length} 个脚本`;
    renderDayPlan();
  } catch (error) {
    statusText.textContent = '解析失败';
    summary.textContent = error.message || String(error);
  } finally {
    fileUpload.value = '';
  }
}

provider.addEventListener('change', syncProviderDefaults);
[authMode, baseURL, model, videoType, maxShots, batchMode].forEach((el) => el.addEventListener('change', () => {
  saveSettings();
  updateApiSummary();
  updateStats();
  if (batchMode.checked) {
    batchTasks = parseBatchScripts();
    activeTaskIndex = -1;
    renderBatchList();
  } else {
    batchTasks = [];
    activeTaskIndex = -1;
    renderBatchList();
  }
}));
[apiKey, baseURL, model].forEach((el) => el.addEventListener('input', updateApiSummary));
[scriptInput, audience, goal, styleTone, mustHave, direction].forEach((el) => el.addEventListener('input', () => {
  updateStats();
  if (batchMode.checked && el === scriptInput) {
    batchTasks = parseBatchScripts();
    activeTaskIndex = batchTasks.length ? 0 : -1;
    renderBatchList();
  }
}));

$('splitPreviewBtn').addEventListener('click', () => {
  batchMode.checked = true;
  saveSettings();
  batchTasks = parseBatchScripts();
  activeTaskIndex = batchTasks.length ? 0 : -1;
  renderBatchList();
  updateStats();
});
openApiBtn.addEventListener('click', () => revealApiSettings('请检查接口设置'));
fileUpload.addEventListener('change', () => uploadFile(fileUpload.files?.[0]));

$('templateBtn').addEventListener('click', () => {
  if (!scriptInput.value.trim()) {
    scriptInput.value = '### 脚本 1\n开场钩子：\n\n核心痛点：\n\n产品/观点亮点：\n\n使用场景：\n\n证据/背书：\n\n结尾行动：\n\n---\n\n### 脚本 2\n开场钩子：\n\n核心痛点：\n\n产品/观点亮点：\n\n使用场景：\n\n证据/背书：\n\n结尾行动：';
    batchMode.checked = true;
    updateStats();
    renderBatchList();
  }
  scriptInput.focus();
});

$('clearBtn').addEventListener('click', () => {
  scriptInput.value = '';
  audience.value = '';
  goal.value = '';
  styleTone.value = '';
  mustHave.value = '';
  direction.value = '';
  batchTasks = [];
  activeTaskIndex = -1;
  currentResult = null;
  renderBatchList();
  renderDayPlan();
  updateStats();
});

generateBtn.addEventListener('click', generate);
stopBatchBtn.addEventListener('click', () => {
  stopBatch = true;
  stopBatchBtn.classList.add('hidden');
});
$('exportJsonBtn').addEventListener('click', () => {
  const tasks = successfulBatchResults();
  const payload = tasks.length ? tasks.map((task) => ({ title: task.title, result: task.result })) : currentResult;
  if (!payload) return;
  download(`shotboard-${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
});
$('exportMdBtn').addEventListener('click', () => {
  const tasks = successfulBatchResults();
  const content = tasks.length
    ? tasks.map((task) => toMarkdown(task.result, task.title)).join('\n\n---\n\n')
    : toMarkdown();
  if (!content) return;
  download(`shotboard-${Date.now()}.md`, content, 'text/markdown');
});
$('exportCsvBtn').addEventListener('click', () => {
  if (!currentResult) return;
  const title = activeTaskIndex >= 0 ? batchTasks[activeTaskIndex]?.title || '' : '';
  download(`shotboard-${Date.now()}.csv`, `\ufeff${toCsv(currentResult, title)}`, 'text/csv;charset=utf-8');
});
$('exportBatchCsvBtn').addEventListener('click', () => {
  const content = toBatchCsv();
  if (!content) return;
  download(`shotboard-batch-${Date.now()}.csv`, `\ufeff${content}`, 'text/csv;charset=utf-8');
});
$('exportShootingBtn').addEventListener('click', () => {
  const tasks = successfulBatchResults();
  const content = tasks.length
    ? tasks.map((task) => toShootingMarkdown(task.result, task.title)).join('\n\n---\n\n')
    : toShootingMarkdown();
  if (!content) return;
  download(`shooting-list-${Date.now()}.md`, content, 'text/markdown');
});
$('exportDayPlanBtn').addEventListener('click', () => {
  const content = toDayPlanMarkdown();
  if (!content) return;
  download(`day-shooting-plan-${Date.now()}.md`, content, 'text/markdown');
});
$('exportTeleprompterBtn').addEventListener('click', () => {
  const tasks = successfulBatchResults();
  const content = tasks.length
    ? tasks.map((task) => toTeleprompterText(task.result, task.title)).join('\n\n---\n\n')
    : toTeleprompterText();
  if (!content) return;
  download(`teleprompter-${Date.now()}.txt`, content, 'text/plain;charset=utf-8');
});
$('tpPlay').addEventListener('click', () => {
  const entries = currentResult?.teleprompter || [];
  if (!entries.length || tpTimer) return;
  tpTimer = setInterval(() => {
    if (tpIndex >= entries.length - 1) {
      clearInterval(tpTimer);
      tpTimer = null;
      return;
    }
    setTeleprompterIndex(tpIndex + 1);
  }, Math.max(1200, Number(entries[tpIndex]?.duration || 3) * 1000));
});
$('tpPause').addEventListener('click', () => {
  clearInterval(tpTimer);
  tpTimer = null;
});
$('tpReset').addEventListener('click', () => {
  clearInterval(tpTimer);
  tpTimer = null;
  setTeleprompterIndex(0);
});

updateStats();
renderBatchList();
updateApiSummary();
