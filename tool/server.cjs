const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const { getShotV2Prompt } = require('../out/ai.js');

const root = __dirname;
const port = Number(process.env.PORT || 3788);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  if (Buffer.isBuffer(body)) {
    res.end(body);
    return;
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('请求内容过大'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('请求 JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function readBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on('data', (chunk) => {
      chunks.push(chunk);
      length += chunk.length;
      if (length > 25 * 1024 * 1024) {
        req.destroy();
        reject(new Error('上传文件过大，请控制在 25MB 以内。'));
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeBaseURL(baseURL, provider) {
  const fallback = provider === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com';
  return (baseURL || fallback).trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function endpointFor(provider, baseURL) {
  return provider === 'openai'
    ? `${baseURL}/v1/chat/completions`
    : `${baseURL}/v1/messages`;
}

function authHeaders(apiKey, authMode, provider) {
  if (authMode === 'bearer' || provider === 'openai') {
    return { authorization: `Bearer ${apiKey}` };
  }
  return { 'x-api-key': apiKey };
}

function extractJson(text) {
  const match = String(text || '').match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error(`AI 返回不是 JSON：${String(text || '').slice(0, 180)}`);
  const raw = match[0];
  try {
    return JSON.parse(raw);
  } catch (error) {
    const repaired = repairLooseJson(raw);
    try {
      return JSON.parse(repaired);
    } catch {
      throw new Error(`AI 返回 JSON 格式错误：${error.message}。请重试，或换一个更严格支持 JSON 输出的模型。`);
    }
  }
}

function repairLooseJson(input) {
  let text = input
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/，/g, ',')
    .replace(/：/g, ':');

  text = text.replace(/,\s*([}\]])/g, '$1');
  text = text.replace(/([{,]\s*)([A-Za-z_$\u4e00-\u9fa5][\w$\u4e00-\u9fa5]*)\s*:/g, '$1"$2":');
  text = text.replace(/:\s*([^",\{\}\[\]\d\-][^,\}\]\n\r]*)/g, (_match, value) => {
    const trimmed = String(value).trim();
    if (/^(true|false|null)$/i.test(trimmed)) return `: ${trimmed.toLowerCase()}`;
    return `: "${trimmed.replace(/^['"]|['"]$/g, '').replace(/"/g, '\\"')}"`;
  });
  return text;
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function speechProfileFor(shot, request) {
  const text = [
    request?.videoType,
    shot.category,
    shot.notes,
    shot.visual,
    shot.actionExpression,
    shot.dialogue,
    shot.scriptText,
  ].filter(Boolean).join(' ');
  if (/剧情|叙事|情绪|留白|停顿|沉默|回忆|感动|痛点|走心|story/i.test(text)) {
    return { label: '叙事/情绪', charsPerSecond: 3.5 };
  }
  if (/硬广|信息点|促销|价格|下单|福利|优惠|卖点|参数|纯信息|快节奏|product/i.test(text)) {
    return { label: '硬广/信息点', charsPerSecond: 5 };
  }
  return { label: '普通口播', charsPerSecond: 4 };
}

function estimateDialogueSeconds(dialogue, profile) {
  const clean = String(dialogue || '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[，。！？、,.!?\s"'“”‘’：:；;]/g, '');
  if (!clean) return 0;
  return Math.max(2, Math.ceil(clean.length / profile.charsPerSecond));
}

function normalizeResult(data, request) {
  const shots = Array.isArray(data) ? data : (data.shots || []);
  const shotsWithIds = shots.map((shot, index) => {
    const dialogue = shot.dialogue || '';
    const speechProfile = speechProfileFor(shot, request);
    const estimatedSpeechSeconds = estimateDialogueSeconds(dialogue, speechProfile);
    const duration = Math.max(Number(shot.duration || 3), estimatedSpeechSeconds || 0);
    return {
      id: shot.id || id(),
      scriptTitle: shot.scriptTitle || '',
      scriptText: shot.scriptText || shot.script || shot.sourceText || dialogue || '',
      shotNo: Number(shot.shotNo || index + 1),
      status: shot.status || '待拍摄',
      sceneName: shot.sceneName || '',
      actorMakeup: shot.actorMakeup || shot.makeup || shot.actorLook || '',
      wardrobeProps: shot.wardrobeProps || shot.costumeProps || shot.wardrobe || '',
      shotType: shot.shotType || '',
      cameraMove: shot.cameraMove || '',
      duration,
      visual: shot.visual || '',
      actionExpression: shot.actionExpression || shot.action || shot.expression || '',
      dialogue,
      subtitle: shot.subtitle || shot.caption || dialogue || '',
      transition: shot.transition || '硬切',
      cast: Array.isArray(shot.cast) ? shot.cast : [],
      equipment: Array.isArray(shot.equipment) ? shot.equipment : [],
      notes: [shot.notes || '', estimatedSpeechSeconds > Number(shot.duration || 0) ? `口播现场预估：${speechProfile.label}约${speechProfile.charsPerSecond}字/秒，建议${duration}秒` : ''].filter(Boolean).join('；'),
      category: shot.category || 'other',
      hostDirection: shot.category === 'talking' ? (shot.hostDirection || null) : null,
      props: Array.isArray(shot.props) ? shot.props : [],
      storyboardImage: shot.storyboardImage || '',
      storyboardImageUrl: shot.storyboardImageUrl || '',
      videoUrl: shot.videoUrl || '',
      hasDialogue: Boolean(shot.hasDialogue ?? dialogue),
      isProductOnly: Boolean(shot.isProductOnly),
    };
  });

  const props = Array.isArray(data.props)
    ? data.props.map((prop) => ({
        id: id(),
        name: prop.name || '',
        shotId: '',
        sceneName: Array.isArray(prop.forScenes) ? prop.forScenes.join('、') : '',
        quantity: Number(prop.totalQuantity || 1),
        status: 'pending',
        notes: prop.notes || '',
      }))
    : shotsWithIds.flatMap((shot) => shot.props.map((name) => ({
        id: id(),
        name,
        shotId: shot.id,
        sceneName: shot.sceneName,
        quantity: 1,
        status: 'pending',
        notes: '',
      })));

  const totalDuration = shotsWithIds.reduce((sum, shot) => sum + shot.duration, 0);
  const teleprompter = shotsWithIds
    .filter((shot) => shot.dialogue)
    .map((shot) => ({
      shotNo: shot.shotNo,
      dialogue: shot.dialogue,
      duration: shot.duration,
      hostDirection: shot.hostDirection || undefined,
    }));
  const shootingGroups = buildShootingGroups(shotsWithIds);
  const propsChecklist = buildPropsChecklist(props);

  return {
    shots: shotsWithIds,
    props,
    propsChecklist,
    shootingGroups,
    summary: request.lang === 'en'
      ? `${shotsWithIds.length} shots, total duration approx ${Math.floor(totalDuration / 60)}min ${totalDuration % 60}s`
      : `共 ${shotsWithIds.length} 个镜头，总时长约 ${Math.floor(totalDuration / 60)} 分 ${totalDuration % 60} 秒`,
    totalDuration,
    teleprompter,
  };
}

function buildShootingGroups(shots) {
  const order = ['empty', 'product', 'broll', 'talking', 'other'];
  const names = {
    empty: '空镜拍摄',
    product: '产品展示',
    broll: 'B-roll 补充画面',
    talking: '口播录制',
    other: '其他镜头',
  };
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
      const estimatedMinutes = Math.max(5, Math.ceil(groupShots.reduce((sum, shot) => sum + shot.duration, 0) * 6 / 60));
      const cameraMoves = [...new Set(groupShots.map((shot) => shot.cameraMove).filter(Boolean))].join('、') || '按现场';
      groups.push({
        groupId: groups.length + 1,
        name: `${scene}｜${names[category]}`,
        category,
        shots: groupShots,
        estimatedMinutes,
        note: `${tips[category]}建议一起拍：镜头 ${groupShots.map((shot) => shot.shotNo).join('、')}。运镜：${cameraMoves}。妆造：${summarizeField(groupShots, 'actorMakeup') || '按镜头表'}。服化道：${summarizeField(groupShots, 'wardrobeProps') || '按镜头表'}。`,
      });
    }
  }
  return groups;
}

function summarizeField(shots, key) {
  return [...new Set(shots.map((shot) => shot[key]).filter(Boolean))].slice(0, 4).join('；');
}

function buildPropsChecklist(props) {
  const totalNeeded = {};
  for (const prop of props) {
    if (!prop.name) continue;
    totalNeeded[prop.name] = (totalNeeded[prop.name] || 0) + Number(prop.quantity || 1);
  }
  return { byShot: props, totalNeeded };
}

async function generateWithRelay(payload) {
  const provider = payload.provider || 'anthropic';
  const apiKey = payload.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('请填写 API Key，或设置 ANTHROPIC_API_KEY / OPENAI_API_KEY 环境变量。');

  const request = payload.request;
  const model = payload.model || (provider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4-20250514');
  const baseURL = normalizeBaseURL(payload.baseURL, provider);
  const url = endpointFor(provider, baseURL);
  const prompt = getShotV2Prompt(request);

  const headers = {
    'content-type': 'application/json',
    ...authHeaders(apiKey, payload.authMode || 'x-api-key', provider),
  };

  let body;
  if (provider === 'openai') {
    body = {
      model,
      max_tokens: Number(payload.maxTokens || 4096),
      temperature: 0.4,
      messages: [
        { role: 'system', content: '你是专业短视频分镜导演。必须只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ],
    };
  } else {
    headers['anthropic-version'] = payload.anthropicVersion || '2023-06-01';
    body = {
      model,
      max_tokens: Number(payload.maxTokens || 4096),
      system: '你是专业短视频分镜导演。必须只输出合法 JSON。',
      messages: [{ role: 'user', content: prompt }],
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`API 请求失败 ${response.status}: ${text.slice(0, 500)}`);
  }

  const raw = JSON.parse(text);
  const content = provider === 'openai'
    ? raw.choices?.[0]?.message?.content
    : raw.content?.find?.((item) => item.type === 'text')?.text || raw.content?.[0]?.text;
  return normalizeResult(extractJson(content), request);
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error('上传请求缺少 boundary。');
  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(marker);
  while (start !== -1) {
    start += marker.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(marker, start);
    if (next === -1) break;
    const part = buffer.slice(start, next - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      parts.push({ headers, body });
    }
    start = next;
  }
  return parts;
}

function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  return buffer.toString('utf8');
}

function parseUploadedText(filename, buffer) {
  const ext = path.extname(filename).toLowerCase();
  if (['.txt', '.md', '.csv'].includes(ext)) {
    const text = decodeText(buffer).trim();
    if (ext === '.csv') {
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length > 1 && /脚本|文案|口播|内容|script/i.test(lines[0])) {
        const headers = splitCsvLine(lines[0]);
        const scriptIndex = headers.findIndex((item) => /脚本|文案|口播|内容|script/i.test(item));
        return lines.slice(1).map((line, index) => {
          const cells = splitCsvLine(line);
          return { title: cells[0] || `${path.basename(filename, ext)}-${index + 1}`, script: cells[scriptIndex] || line };
        }).filter((item) => item.script.trim());
      }
    }
    return [{ title: path.basename(filename, ext), script: text }];
  }
  throw new Error('文本上传仅支持 .txt、.md、.csv；Excel 请上传 .xlsx。');
}

function splitCsvLine(line) {
  const result = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      result.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  result.push(value.trim());
  return result;
}

async function parseUploadedXlsx(filename, buffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shotboard-upload-'));
  const filePath = path.join(tempDir, filename || 'upload.xlsx');
  const scriptPath = path.join(tempDir, 'parse_xlsx.py');
  fs.writeFileSync(filePath, buffer);
  fs.writeFileSync(scriptPath, `
import json
import sys
from openpyxl import load_workbook

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

path = sys.argv[1]
wb = load_workbook(path, data_only=True)
items = []
script_keys = ["脚本", "文案", "口播", "内容", "内部文案", "口播稿"]
shot_table_keys = ["分镜号", "镜头", "时间", "时长", "画面", "景别", "运镜", "台词", "分镜画面"]
for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        continue
    header_row = None
    for idx, row in enumerate(rows[:8]):
        values = [str(v).strip() if v is not None else "" for v in row]
        hit_count = sum(1 for v in values for k in (script_keys + shot_table_keys) if k in v)
        if hit_count >= 2:
            header_row = idx
            break
    if header_row is not None:
        headers = [str(v).strip() if v is not None else "" for v in rows[header_row]]
        is_shot_table = sum(1 for h in headers for k in shot_table_keys if k in h) >= 2
        title_col = next((i for i, h in enumerate(headers) if "标题" in h or "名称" in h or "项目" in h), None)
        if is_shot_table:
            table_lines = []
            table_lines.append(" | ".join(h for h in headers if h))
            for row in rows[header_row + 1:]:
                values = [str(v).strip() if v is not None else "" for v in row[:len(headers)]]
                if any(values):
                    table_lines.append(" | ".join(values))
            script = "\\n".join(table_lines).strip()
            if script:
                items.append({"title": ws.title, "script": script})
        else:
            script_cols = [i for i, h in enumerate(headers) if any(k in h for k in script_keys)]
            for ridx, row in enumerate(rows[header_row + 1:], start=1):
                parts = []
                for col in script_cols:
                    if col < len(row) and row[col] not in (None, ""):
                        parts.append(str(row[col]).strip())
                script = "\\n".join(dict.fromkeys(parts)).strip()
                if script:
                    title = str(row[title_col]).strip() if title_col is not None and title_col < len(row) and row[title_col] else f"{ws.title}-{ridx}"
                    items.append({"title": title, "script": script})
    else:
        text = []
        for row in rows:
            vals = [str(v).strip() for v in row if v not in (None, "")]
            if vals:
                text.append(" | ".join(vals))
        script = "\\n".join(text).strip()
        if script:
            items.append({"title": ws.title, "script": script})
print(json.dumps(items, ensure_ascii=False))
`, 'utf8');

  return new Promise((resolve, reject) => {
    const child = spawn('python', [scriptPath, filePath], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('close', (code) => {
      fs.rm(tempDir, { recursive: true, force: true }, () => {});
      if (code !== 0) {
        reject(new Error(stderr || 'Excel 解析失败'));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Excel 解析结果格式错误'));
      }
    });
  });
}

async function parseUpload(req) {
  const contentType = req.headers['content-type'] || '';
  const buffer = await readBuffer(req);
  const part = parseMultipart(buffer, contentType).find((item) => /name="file"/.test(item.headers));
  if (!part) throw new Error('没有收到上传文件。');
  const filename = part.headers.match(/filename="([^"]*)"/i)?.[1] || 'upload';
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.xlsx') return parseUploadedXlsx(filename, part.body);
  return parseUploadedText(filename, part.body);
}

function serveFile(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.resolve(root, `.${urlPath}`);
  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, mime[path.extname(filePath)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/generate') {
      const payload = await readJson(req);
      const result = await generateWithRelay(payload);
      return send(res, 200, result);
    }
    if (req.method === 'POST' && req.url === '/api/upload') {
      const items = await parseUpload(req);
      return send(res, 200, { items });
    }
    if (req.method === 'GET') return serveFile(req, res);
    send(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    send(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Shotboard 工具已启动：${url}`);
  if (process.env.NO_OPEN !== '1') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
