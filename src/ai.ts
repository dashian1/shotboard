import Anthropic from '@anthropic-ai/sdk';
import {
  Shot, GenerateRequest, GenerateResponse, ScheduleRequest, SceneBlock,
  VideoType, Lang, ShotCategory,
  VenueAnalysis, ProductAnalysis, VideoAnalysis,
  GenerateRequestV2, GenerateResponseV2,
  TeleprompterEntry, PropsChecklist, PropItem, PropStatus,
  ShootingGroup, HostDirection,
} from './types';

// ==================== Prompt 模板 ====================

function getShotPrompt(req: GenerateRequest): string {
  // V1 保留，见下文修改
  return getShotV2Prompt({
    script: req.script,
    videoType: req.videoType,
    lang: req.lang,
    maxShots: req.maxShots,
    mediaInputs: [],
  });
}

export function getShotV2Prompt(req: GenerateRequestV2): string {
  const langInstruction = req.lang === 'zh'
    ? '请用中文回答。镜头字段用中文（景别、运镜、转场等）。如果原始文案是英文，画面描述和对白保留英文。'
    : 'Please answer in English. All shot fields should be in English.';

  const videoTypeGuide: Record<VideoType, string> = {
    talking: '口播类：以人物表达为主，镜头要有中景/近景/特写变化，并用 B-roll 遮挡跳切；每段对白要对应明确表情、手势和停顿。',
    story: '剧情类：按起因、冲突、转折、结果拆镜头；每个镜头必须交代人物动作、空间关系和情绪变化。',
    vlog: 'Vlog 类：保留生活感和现场感；优先使用手持、跟拍、环境声、自然转场，不要过度广告化。',
    product: '产品展示/带货类：先建立使用痛点，再展示产品外观、关键功能、使用过程、细节特写和结果反馈；避免夸大功效。',
    general: '通用类型：根据文案意图选择结构，保证开场抓人、中段信息清楚、结尾有行动指令或记忆点。',
  };

  // 构建多模态上下文
  let mediaContext = '';
  if (req.venueAnalysis) {
    mediaContext += `
## 场地分析结果（已上传场地照片/平面图）
- 光线条件: ${req.venueAnalysis.lighting}
- 布局: ${req.venueAnalysis.layout}
- 推荐机位: ${req.venueAnalysis.shootingPositions.join(', ')}
- 限制: ${req.venueAnalysis.limitations.join(', ') || '无'}
- 建议: ${req.venueAnalysis.suggestions.join('; ')}
请参考以上场地信息来设计每个镜头的场景位置和机位。
`;
  }
  if (req.productAnalysis) {
    mediaContext += `
## 产品照片分析
- 关键展示角度: ${req.productAnalysis.keyAngles.join(', ')}
- 需要突出的功能点: ${req.productAnalysis.features.join(', ')}
- 建议的展示镜头: ${req.productAnalysis.suggestedShots.join(', ')}
- 细节特写建议: ${req.productAnalysis.detailHighlights.join(', ')}
请确保产品展示镜头覆盖以上角度和功能点。
`;
  }
  if (req.videoAnalysis) {
    mediaContext += `
## 参考视频风格分析
- 整体风格: ${req.videoAnalysis.overallStyle}
- 节奏: ${req.videoAnalysis.pace}
- 镜头模式: ${req.videoAnalysis.shotPatterns.join(', ')}
- 色调: ${req.videoAnalysis.colorPalette}
- 转场: ${req.videoAnalysis.transitions.join(', ')}
- 值得借鉴的技巧: ${req.videoAnalysis.keyTechniques.join(', ')}
请在分镜中参考以上风格特点。
`;
  }

  return `你是短视频现场导演。你的目标不是生成一份好看的分镜，而是输出一份现场可以直接执行的拍摄方案。所有输出都围绕降低沟通成本、提高拍摄效率展开，让导演、摄影、主播、场务、剪辑拿到结果后无需二次整理即可执行。

${langInstruction}
类型：${videoTypeGuide[req.videoType]}
${mediaContext}

必须回答：拍什么、谁来拍、去哪里拍、穿什么、用什么拍、哪些镜头一起拍最省时间、口播怎么录、哪些信息还需要确认。所有生成内容都以“当天能够完成拍摄”为第一目标，而不是追求字段数量。

规则：
1. 已有分镜表：保留原镜头顺序，只补齐缺失字段。
2. 完整脚本/口播稿：按表达节奏拆镜头，不要一句一镜；最多 ${req.maxShots} 个镜头。
3. 开头 3 秒要有抓人画面；每 2-4 个口播镜头插入产品或 B-roll。
4. 口播时长是现场预估，不是绝对值。按内容类型估算：叙事/情绪类约 3.5 字/秒，要保留停顿、重音和情绪留白；普通口播约 4 字/秒；硬广/纯信息点约 5 字/秒。英文可按 2.5 词/秒上下浮动。长口播不要硬写成 3 秒，必要时拆成多个镜头。
5. 拍摄要考虑效率：同场景、同产品、同机位/同运镜的镜头尽量标成相同 sceneName、shotType、cameraMove，方便后续集中拍。
6. 每个镜头都要考虑服化道：actorMakeup 写演员妆造（素颜/淡妆/全妆/带妆、发型、出镜状态），wardrobeProps 写服装、化妆、道具、产品准备；无人镜头也要写产品、道具和场景整理要求。
7. 为了降低编导和拍摄团队沟通成本，同一主播、同一妆造、同一服装、同一场景的口播镜头要保持 actorMakeup、wardrobeProps、sceneName 一致，方便当天计划合并为连续录制。
8. 同景别不同服装时，尽量保持 sceneName、shotType、cameraMove 一致，方便现场锁机位后按服装单向拍完，避免来回换装。
9. 表演和台词不一定同步：正脸口播/对口型镜头按同期口播设计；背影、手部、产品、情绪画面可设计为先拍画面，后配旁白/口播。
10. AI/后期替换只作为候选：空景、远景、背影、服装参考可评估；正脸口播、手持产品、包装文字、真实试用优先实拍。
11. 准确性优先：只能使用输入脚本里出现的信息或用户补充要求；不确定的场景、道具、妆造、服装写“待确认”，链接字段留空，不要猜。
12. 不编造产品功效、价格、承诺、分镜图链接、视频链接，不改写脚本名称。
13. 批量时每次只处理本次脚本名称对应的单条脚本，禁止把其它脚本混入当前结果。
14. 只输出合法 JSON，不要 Markdown、解释、注释。

镜头字段：
shotNo 数字连续；scriptText 原文片段；status 默认“待拍摄”；sceneName 场景；actorMakeup 演员妆造（素颜/淡妆/全妆/带妆、发型、状态）；wardrobeProps 服化道（服装、化妆、道具、产品准备）；shotType 景别；cameraMove 运镜；duration 秒数数字；visual 画面（主体、构图、画面重点）；actionExpression 动作神情（动作、表情、手势、情绪）；dialogue 口播稿；subtitle 字幕（适合上屏的短句，无则空字符串）；transition 默认“硬切”；cast/equipment/props 数组；notes 备注；category 只能为 empty/talking/product/broll/other；storyboardImage/storyboardImageUrl/videoUrl 无则空字符串；hasDialogue/isProductOnly 布尔值；talking 镜头给 hostDirection，其他为 null。

数量要求：duration、quantity、totalQuantity 只能是数字；“少许/适量/若干”写进 notes，数量默认 1。duration 是现场预估时长，剧情/情绪口播允许更长，硬广信息点可更短更快。

JSON 格式：
{
  "shots": [
    {
      "shotNo": 1,
      "scriptText": "",
      "status": "待拍摄",
      "sceneName": "",
      "actorMakeup": "淡妆，头发整洁，状态自然",
      "wardrobeProps": "浅色上衣；产品擦拭干净；桌面无杂物",
      "shotType": "近景",
      "cameraMove": "固定",
      "duration": 3,
      "visual": "",
      "actionExpression": "",
      "dialogue": "",
      "subtitle": "",
      "transition": "硬切",
      "cast": [],
      "equipment": [],
      "notes": "",
      "category": "talking",
      "props": [],
      "storyboardImage": "",
      "storyboardImageUrl": "",
      "videoUrl": "",
      "hasDialogue": true,
      "isProductOnly": false,
      "hostDirection": {
        "lineIndex": 0,
        "tone": "自然",
        "expression": "微笑",
        "gesture": "无",
        "eyeDirection": "看镜头",
        "posture": "站立",
        "emphasisWords": [],
        "breathingPoint": false,
        "movement": "无"
      }
    }
  ],
  "props": [
    { "name": "", "forScenes": [], "totalQuantity": 1, "notes": "" }
  ]
}

输入：
${req.script}`;
}

function getSchedulePrompt(req: ScheduleRequest): string {
  // 增强版 schedule prompt，按类别分组
  const shotsJson = JSON.stringify(req.shots, null, 2);
  return `你是资深的影视制片人和场务主管，擅长将分镜头脚本编排为高效的拍摄日程。

## 任务
基于以下分镜头脚本，建议最优的拍摄日程安排。目标是：
1. 按类别分组：先排空镜（empty）→ 纯产品展示（product，无口播）→ B-roll → 口播（talking）
2. 按场景聚合：相同场景的镜头排在一起，减少转场时间
3. 考虑演员调度：口播类集中拍摄，主播一次性到位
4. 合理估计拍摄时长

## 拍摄时间段
${req.startTime} - ${req.endTime}

## 拍摄地点
${req.location}

## 分镜头列表
${shotsJson}

## 输出格式
请直接输出 JSON 对象，不要任何其他文字：
{
  "groups": [
    {
      "groupId": 1,
      "name": "空镜",
      "category": "empty",
      "shotNos": [1, 2],
      "estimatedMinutes": 30,
      "note": "主播未到场的先拍"
    }
  ],
  "blocks": [
    {
      "blockNo": 1,
      "sceneName": "场景名",
      "timeSlot": "09:00-10:30",
      "shotNos": [1, 2, 3],
      "castNeeded": [],
      "equipmentNeeded": ["相机", "灯光"],
      "estimatedDuration": 90,
      "notes": "备注"
    }
  ],
  "totalEstimatedMinutes": 480
}`;
}

function getVenueAnalysisPrompt(): string {
  return `你是一个资深的摄影指导和灯光师。仔细分析这张场地照片/平面图，输出中文分析结果。

请输出 JSON 对象，包含：
- lighting: 光线条件描述
- layout: 布局描述
- shootingPositions: 推荐的机位列表
- limitations: 拍摄限制列表
- suggestions: 改进建议列表

直接输出 JSON，不要其他文字。`;
}

function getProductAnalysisPrompt(): string {
  return `你是一个资深的产品摄影师和电商视觉策划。仔细分析这张产品照片，输出中文分析结果。

请输出 JSON 对象，包含：
- keyAngles: 需要展示的关键角度列表（如 "正面", "侧面45度", "细节特写"）
- features: 需要突出的功能点列表
- suggestedShots: 建议的展示镜头描述列表
- detailHighlights: 值得特写的细节列表

直接输出 JSON，不要其他文字。`;
}

function getVideoAnalysisPrompt(): string {
  return `你是一个资深的视频导演和剪辑师。基于对参考视频的描述，分析其风格特点，输出中文分析结果。

请输出 JSON 对象，包含：
- pace: 节奏描述（如 "快节奏，快速切换"）
- shotPatterns: 镜头模式列表（如 "开场全景→中景→特写交替"）
- colorPalette: 色调描述
- transitions: 转场方式列表
- keyTechniques: 值得借鉴的关键技巧列表
- overallStyle: 整体风格描述

直接输出 JSON，不要其他文字。`;
}

function getTeleprompterPrompt(shots: Shot[], lang: Lang): string {
  const shotsJson = JSON.stringify(shots.map(s => ({
    shotNo: s.shotNo,
    dialogue: s.dialogue,
    category: s.category,
    hostDirection: s.hostDirection,
    duration: s.duration,
  })), null, 2);
  const langInstruction = lang === 'zh'
    ? '请按原有内容输出，保留中英文。'
    : 'Output in English.';

  return `你是一个专业的提词器编辑。基于以下镜头数据，提取所有有对白的镜头，生成提词器条目。

${langInstruction}

对提词器条目的要求：
- shotNo: 镜头编号
- dialogue: 对白文本，去掉旁白标记和语气词注释，只保留演员要说的内容
- estimatedSeconds: 预估朗读时长（秒）。叙事/情绪类按约3.5字/秒，普通口播按约4字/秒，硬广/纯信息点按约5字/秒；这是现场预估，不是绝对值。
- pauseAfter: 读完这句后是否需要停顿（秒）

## 镜头数据
${shotsJson}

## 输出格式
直接输出 JSON 数组，不要其他文字：
[
  {
    "shotNo": 1,
    "dialogue": "大家好，欢迎收看本期节目。",
    "estimatedSeconds": 4,
    "pauseAfter": 0.5
  }
]`;
}

function getPropsListPrompt(shots: Shot[]): string {
  const shotsJson = JSON.stringify(shots.map(s => ({
    shotNo: s.shotNo,
    sceneName: s.sceneName,
    category: s.category,
    props: s.props,
  })), null, 2);

  return `你是一个经验丰富的道具管理。基于以下镜头数据，整理完整的道具清单。

## 镜头数据
${shotsJson}

## 输出格式
直接输出 JSON 对象，不要其他文字：
{
  "byShot": [
    {
      "name": "产品A",
      "shotNo": 1,
      "sceneName": "书房",
      "quantity": 1,
      "notes": "需要擦干净"
    }
  ],
  "totalNeeded": {
    "产品A": 2,
    "道具B": 1
  }
}`;
}

function getSequencePrompt(shots: Shot[]): string {
  const shotsJson = JSON.stringify(shots, null, 2);
  return `你是一个资深的场务主管和制片助理。基于以下分镜头脚本，按照最高效的拍摄顺序分组。

## 排序原则
1. 先拍空镜（empty）— 主播不需要在场
2. 再拍纯产品展示（product, isProductOnly=true）— 主播不需要在场
3. 然后拍 B-roll — 可以穿插拍摄
4. 最后集中拍口播（talking）— 主播到齐后一次性拍完

## 分镜头数据
${shotsJson}

## 输出格式
直接输出 JSON 数组，不要其他文字：
[
  {
    "groupId": 1,
    "name": "空镜拍摄",
    "category": "empty",
    "shotNos": [1, 5, 6],
    "estimatedMinutes": 45,
    "note": "主播未到场，先拍场景空镜"
  }
]`;
}

// ==================== 工具函数 ====================

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function addIdsToShots(shots: Shot[]): Shot[] {
  return shots.map(shot => ({ ...shot, id: generateId() }));
}

function addIdsToProps(props: PropItem[]): PropItem[] {
  return props.map(p => ({ ...p, id: generateId() }));
}

function normalizeBaseURL(baseURL?: string): string | undefined {
  if (!baseURL) return undefined;
  const trimmed = baseURL.trim().replace(/\/+$/, '');
  return trimmed.replace(/\/v1$/i, '');
}

// ==================== AI Service ====================

export class AiService {
  private client: Anthropic | null = null;
  private model: string;

  constructor(apiKey?: string | { apiKey?: string; baseURL?: string; model?: string }) {
    const options = typeof apiKey === 'object' ? apiKey : { apiKey };
    const key = options.apiKey || process.env['ANTHROPIC_API_KEY'];
    const baseURL = normalizeBaseURL(options.baseURL || process.env['ANTHROPIC_BASE_URL']);
    this.model = options.model || process.env['ANTHROPIC_MODEL'] || 'claude-sonnet-4-20250514';
    if (key) {
      this.client = new Anthropic({ apiKey: key, baseURL });
    }
  }

  private ensureClient(): Anthropic {
    if (!this.client) {
      throw new Error('未配置 API Key。请在 VS Code 设置中设置 shotboard.apiKey，或设置 ANTHROPIC_API_KEY 环境变量。');
    }
    return this.client;
  }

  private async callWithJson<T>(prompt: string, systemMsg: string, jsonExtract: (text: string) => T): Promise<T> {
    const client = this.ensureClient();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: systemMsg,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('AI 返回格式异常，请重试。原始响应: ' + text.slice(0, 200));
    }
    return jsonExtract(jsonMatch[0]);
  }

  // ==================== V1 保留方法 ====================

  async generateShots(req: GenerateRequest): Promise<GenerateResponse> {
    const prompt = getShotPrompt(req);
    const result = await this.callWithJson<{ shots: Shot[]; props?: PropItem[] }>(
      prompt,
      "你是一个专业的短视频分镜师。请严格按照输出格式返回 JSON。",
      (text) => {
        const data = JSON.parse(text);
        if (Array.isArray(data)) return { shots: data };
        return { shots: data.shots || [], props: data.props };
      }
    );
    const shotsWithIds = addIdsToShots(result.shots);
    const totalDuration = shotsWithIds.reduce((sum, s) => sum + s.duration, 0);
    const summary = req.lang === 'zh'
      ? `共 ${shotsWithIds.length} 个镜头，总时长约 ${Math.round(totalDuration / 60)} 分 ${totalDuration % 60} 秒`
      : `${shotsWithIds.length} shots, total duration approx ${Math.floor(totalDuration / 60)}min ${totalDuration % 60}s`;
    return { shots: shotsWithIds, summary, totalDuration };
  }

  async suggestSchedule(req: ScheduleRequest): Promise<{ blocks: SceneBlock[]; totalEstimatedMinutes: number }> {
    const prompt = getSchedulePrompt(req);
    const shotMap = new Map(req.shots.map(s => [s.shotNo, s]));
    const result = await this.callWithJson<{ groups?: any[]; blocks: any[]; totalEstimatedMinutes: number }>(
      prompt,
      "你是一个专业的影视制片人。请严格按照输出格式返回 JSON。",
      (text) => JSON.parse(text)
    );
    const blocks: SceneBlock[] = result.blocks.map((b: any) => ({
      blockNo: b.blockNo,
      sceneName: b.sceneName,
      timeSlot: b.timeSlot,
      shots: (b.shotNos || []).map((id: number) => shotMap.get(id)).filter(Boolean),
      castNeeded: b.castNeeded || [],
      equipmentNeeded: b.equipmentNeeded || [],
      estimatedDuration: b.estimatedDuration,
      notes: b.notes || '',
    }));
    return { blocks, totalEstimatedMinutes: result.totalEstimatedMinutes };
  }

  // ==================== V2 多模态分析 ====================

  async analyzeVenue(imageBase64: string): Promise<VenueAnalysis> {
    const client = this.ensureClient();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: "你是一个资深的摄影指导。分析图片中拍摄场地的光线、布局和机位建议。输出中文 JSON。",
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: getVenueAnalysisPrompt() },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        ],
      }],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('场地分析失败');
    return JSON.parse(jsonMatch[0]) as VenueAnalysis;
  }

  async analyzeProduct(imageBase64: string): Promise<ProductAnalysis> {
    const client = this.ensureClient();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: "你是一个资深的产品摄影师。分析产品照片，给出拍摄角度和展示建议。输出中文 JSON。",
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: getProductAnalysisPrompt() },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        ],
      }],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('产品分析失败');
    return JSON.parse(jsonMatch[0]) as ProductAnalysis;
  }

  async analyzeReferenceVideo(description: string): Promise<VideoAnalysis> {
    const prompt = getVideoAnalysisPrompt() + `\n\n## 视频描述\n${description}`;
    return this.callWithJson<VideoAnalysis>(
      prompt,
      "你是一个资深的视频导演。分析视频风格。输出中文 JSON。",
      (text) => JSON.parse(text)
    );
  }

  // ==================== V2 增强生成 ====================

  async generateShotsV2(req: GenerateRequestV2): Promise<GenerateResponseV2> {
    const prompt = getShotV2Prompt(req);
    const result = await this.callWithJson<{ shots: Shot[]; props: any[] }>(
      prompt,
      "你是一个专业的短视频导演。严格按照输出格式返回 JSON。",
      (text) => JSON.parse(text)
    );
    const shotsWithIds = addIdsToShots(result.shots);
    const totalDuration = shotsWithIds.reduce((sum, s) => sum + s.duration, 0);

    // 生成提词器
    const teleprompter = await this.generateTeleprompter(shotsWithIds);

    // 生成道具清单
    let props: PropItem[] = [];
    if (result.props && result.props.length > 0) {
      props = addIdsToProps(result.props.map((p: any, i: number) => ({
        id: '',
        name: p.name || '',
        shotId: shotsWithIds[i]?.id || '',
        sceneName: p.forScenes?.[0] || '',
        quantity: p.totalQuantity || 1,
        status: 'pending' as PropStatus,
        notes: p.notes || '',
      })));
    } else {
      props = this.buildPropsFromShots(shotsWithIds);
    }

    const summary = req.lang === 'zh'
      ? `共 ${shotsWithIds.length} 个镜头，总时长约 ${Math.round(totalDuration / 60)} 分 ${totalDuration % 60} 秒`
      : `${shotsWithIds.length} shots, total duration approx ${Math.floor(totalDuration / 60)}min ${totalDuration % 60}s`;

    return { shots: shotsWithIds, props, summary, totalDuration, teleprompter };
  }

  async generateTeleprompter(shots: Shot[]): Promise<TeleprompterEntry[]> {
    const prompt = getTeleprompterPrompt(shots, 'zh');
    try {
      const result = await this.callWithJson<any[]>(
        prompt,
        "你是一个提词器编辑。输出 JSON 数组。",
        (text) => JSON.parse(text)
      );
      return result.map((entry: any) => ({
        shotNo: entry.shotNo,
        dialogue: entry.dialogue,
        duration: entry.estimatedSeconds || 3,
        hostDirection: shots.find(s => s.shotNo === entry.shotNo)?.hostDirection,
      }));
    } catch {
      // 如果提词器生成失败，从 shots 直接提取
      return shots.filter(s => s.dialogue).map(s => ({
        shotNo: s.shotNo,
        dialogue: s.dialogue,
        duration: s.duration,
        hostDirection: s.hostDirection,
      }));
    }
  }

  async generatePropsList(shots: Shot[]): Promise<PropsChecklist> {
    const prompt = getPropsListPrompt(shots);
    try {
      const result = await this.callWithJson<{ byShot: any[]; totalNeeded: Record<string, number> }>(
        prompt,
        "你是一个道具管理。输出 JSON。",
        (text) => JSON.parse(text)
      );
      const byShot: PropItem[] = result.byShot.map((p: any) => {
        const shot = shots.find(s => s.shotNo === p.shotNo);
        return {
          id: generateId(),
          name: p.name,
          shotId: shot?.id || '',
          sceneName: p.sceneName || shot?.sceneName || '',
          quantity: p.quantity || 1,
          status: 'pending' as PropStatus,
          notes: p.notes || '',
        };
      });
      const byCategory: any = {};
      for (const cat of ['empty', 'talking', 'product', 'broll', 'other'] as ShotCategory[]) {
        byCategory[cat] = byShot.filter(p => {
          const shot = shots.find(s => s.id === p.shotId);
          return shot?.category === cat;
        });
      }
      return { byShot, byCategory, totalNeeded: result.totalNeeded || {} };
    } catch {
      return this.buildPropsChecklist(shots);
    }
  }

  async suggestShootingSequence(shots: Shot[]): Promise<ShootingGroup[]> {
    const prompt = getSequencePrompt(shots);
    try {
      const result = await this.callWithJson<any[]>(
        prompt,
        "你是一个场务主管。输出 JSON 数组。",
        (text) => JSON.parse(text)
      );
      return result.map((g: any) => ({
        groupId: g.groupId,
        name: g.name,
        category: g.category as ShotCategory,
        shots: (g.shotNos || []).map((no: number) => shots.find(s => s.shotNo === no)).filter(Boolean),
        estimatedMinutes: g.estimatedMinutes,
        note: g.note || '',
      }));
    } catch {
      return this.buildDefaultSequence(shots);
    }
  }

  // ==================== 本地回退逻辑 ====================

  private buildPropsFromShots(shots: Shot[]): PropItem[] {
    const props: PropItem[] = [];
    for (const shot of shots) {
      if (shot.props && shot.props.length > 0) {
        for (const propName of shot.props) {
          props.push({
            id: generateId(),
            name: propName,
            shotId: shot.id,
            sceneName: shot.sceneName,
            quantity: 1,
            status: 'pending',
            notes: '',
          });
        }
      }
    }
    return props;
  }

  private buildPropsChecklist(shots: Shot[]): PropsChecklist {
    const byShot = this.buildPropsFromShots(shots);
    const byCategory: Record<string, PropItem[]> = {};
    for (const cat of ['empty', 'talking', 'product', 'broll', 'other'] as ShotCategory[]) {
      byCategory[cat] = byShot.filter(p => {
        const shot = shots.find(s => s.id === p.shotId);
        return shot?.category === cat;
      });
    }
    const totalNeeded: Record<string, number> = {};
    for (const p of byShot) {
      totalNeeded[p.name] = (totalNeeded[p.name] || 0) + p.quantity;
    }
    return { byShot, byCategory, totalNeeded };
  }

  private buildDefaultSequence(shots: Shot[]): ShootingGroup[] {
    const categoryOrder: ShotCategory[] = ['empty', 'product', 'broll', 'talking', 'other'];
    const groupNames: Record<ShotCategory, string> = {
      empty: '空镜拍摄',
      product: '产品展示',
      broll: 'B-roll 穿插',
      talking: '口播录制',
      other: '其他镜头',
    };
    const groupNotes: Record<ShotCategory, string> = {
      empty: '主播未到场，先拍场景空镜',
      product: '纯产品展示，无需主播到场',
      broll: '辅助画面，可穿插拍摄',
      talking: '主播到场后集中拍摄',
      other: '',
    };

    return categoryOrder.map((cat, idx) => {
      const groupShots = shots.filter(s => s.category === cat);
      if (groupShots.length === 0) return null;
      const totalMin = groupShots.reduce((s, sh) => s + sh.duration * 8, 0); // 实际拍摄约8倍
      return {
        groupId: idx + 1,
        name: groupNames[cat],
        category: cat,
        shots: groupShots,
        estimatedMinutes: Math.ceil(totalMin / 60),
        note: groupNotes[cat],
      };
    }).filter(Boolean) as ShootingGroup[];
  }
}
