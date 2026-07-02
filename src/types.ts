// 分镜头脚本类型定义 — V2 多模态导演助理

// ==================== 基础枚举 ====================

/** 景别 */
export type ShotType = '远景' | '全景' | '中景' | '近景' | '特写'
  | 'establishing' | 'wide' | 'full' | 'medium' | 'close-up' | 'extreme-close-up';

/** 运镜 */
export type CameraMove = '固定' | '推' | '拉' | '摇' | '移' | '跟' | '升降' | '环绕' | '手持'
  | 'static' | 'push' | 'pull' | 'pan' | 'track' | 'follow' | 'crane' | 'circle' | 'handheld';

/** 转场 */
export type Transition = '硬切' | '淡入' | '淡出' | '交叉溶解' | '擦除' | '白闪' | '黑屏'
  | 'cut' | 'fade-in' | 'fade-out' | 'dissolve' | 'wipe' | 'white-flash' | 'blackout';

/** 短视频类型 */
export type VideoType = 'talking' | 'story' | 'vlog' | 'product' | 'general';

/** 语言 */
export type Lang = 'zh' | 'en';

/** 镜头分类标签 */
export type ShotCategory = 'empty' | 'talking' | 'product' | 'broll' | 'other';

/** 道具状态 */
export type PropStatus = 'pending' | 'ready' | 'checked';

// ==================== V2 核心接口 ====================

/** 主播口播详细指导 — 逐句设计 */
export interface HostDirection {
  lineIndex: number;
  tone: string;                 // 语气：轻松/正式/激情/温柔/紧迫
  expression: string;           // 表情：微笑/严肃/惊讶/自信
  gesture: string;              // 手势：手指产品/张开双臂/比划大小
  eyeDirection: string;         // 眼神方向：看镜头/看产品/看左侧/低头
  posture: string;              // 体态：站立/坐着/侧身/走动
  emphasisWords: string[];      // 重音词
  breathingPoint: boolean;      // 是否换气点/停顿
  movement: string;             // 走位：向前一步/向左移动/转身
}

/** 道具 */
export interface PropItem {
  id: string;
  name: string;
  shotId: string;
  sceneName: string;
  quantity: number;
  status: PropStatus;
  notes: string;
}

/** 提词器条目 */
export interface TeleprompterEntry {
  shotNo: number;
  dialogue: string;
  hostDirection?: HostDirection;
  duration: number;
}

/** 镜头 (V2) — 包含分类、主播指导、道具等 */
export interface Shot {
  id: string;
  shotNo: number;
  sceneName: string;
  shotType: string;
  cameraMove: string;
  duration: number;
  actorMakeup?: string;
  wardrobeProps?: string;
  visual: string;
  actionExpression?: string;
  dialogue: string;
  subtitle?: string;
  transition: string;
  cast: string[];
  equipment: string[];
  notes: string;
  // V2 扩展字段
  category: ShotCategory;
  hostDirection?: HostDirection;
  props: string[];
  hasDialogue: boolean;
  isProductOnly: boolean;
}

/** 场次 / 拍摄块 (V2) */
export interface SceneBlock {
  blockNo: number;
  sceneName: string;
  timeSlot: string;
  shots: Shot[];
  castNeeded: string[];
  equipmentNeeded: string[];
  estimatedDuration: number;
  notes: string;
}

/** 演员 */
export interface CastMember {
  id: string;
  name: string;
  role: string;
  arrivalTime: string;
  contact: string;
  notes: string;
}

/** 设备 */
export interface EquipmentItem {
  id: string;
  name: string;
  quantity: number;
  purpose: string;
  responsible: string;
  cost: number;
}

/** 预算项 */
export interface BudgetItem {
  id: string;
  category: string;
  item: string;
  estimatedCost: number;
  actualCost: number;
  notes: string;
}

/** 拍摄日 */
export interface ShootingDay {
  date: string;
  location: string;
  blocks: SceneBlock[];
  castList: CastMember[];
  equipmentList: EquipmentItem[];
  budget: BudgetItem[];
  notes: string;
}

// ==================== 多模态分析 ====================

/** 多模态输入 */
export interface MediaInput {
  type: 'venue' | 'reference_video' | 'product_photo' | 'floor_plan';
  localPath: string;
  description?: string;
  aiAnalysis?: string;
  base64Data?: string;
}

/** 场地分析结果 */
export interface VenueAnalysis {
  lighting: string;
  layout: string;
  shootingPositions: string[];
  limitations: string[];
  suggestions: string[];
}

/** 参考视频分析 */
export interface VideoAnalysis {
  pace: string;
  shotPatterns: string[];
  colorPalette: string;
  transitions: string[];
  keyTechniques: string[];
  overallStyle: string;
}

/** 产品照片分析 */
export interface ProductAnalysis {
  keyAngles: string[];
  features: string[];
  suggestedShots: string[];
  detailHighlights: string[];
}

/** 道具准备总清单 */
export interface PropsChecklist {
  byShot: PropItem[];
  byCategory: Record<ShotCategory, PropItem[]>;
  totalNeeded: Record<string, number>;
}

/** 拍摄分组（按类型排序） */
export interface ShootingGroup {
  groupId: number;
  name: string;
  category: ShotCategory;
  shots: Shot[];
  estimatedMinutes: number;
  note: string;
}

// ==================== 请求/响应 ====================

/** AI 生成请求 (V1) */
export interface GenerateRequest {
  script: string;
  videoType: VideoType;
  lang: Lang;
  maxShots: number;
}

/** AI 生成响应 (V1) */
export interface GenerateResponse {
  shots: Shot[];
  summary: string;
  totalDuration: number;
}

/** AI 生成请求 (V2 多模态) */
export interface GenerateRequestV2 {
  script: string;
  videoType: VideoType;
  lang: Lang;
  maxShots: number;
  mediaInputs: MediaInput[];
  venueAnalysis?: VenueAnalysis;
  productAnalysis?: ProductAnalysis;
  videoAnalysis?: VideoAnalysis;
}

/** AI 生成响应 (V2) */
export interface GenerateResponseV2 {
  shots: Shot[];
  props: PropItem[];
  summary: string;
  totalDuration: number;
  teleprompter: TeleprompterEntry[];
}

/** 日程建议请求 */
export interface ScheduleRequest {
  shots: Shot[];
  startTime: string;
  endTime: string;
  location: string;
}

// ==================== 应用状态 ====================

/** 应用状态 (V2) */
export interface AppState {
  projectName: string;
  scriptText: string;
  shots: Shot[];
  videoType: VideoType;
  lang: Lang;
  shootingDay: ShootingDay;
  maxShots: number;
  // V2 扩展
  mediaInputs: MediaInput[];
  venueAnalysis?: VenueAnalysis;
  productAnalysis?: ProductAnalysis;
  videoAnalysis?: VideoAnalysis;
  propsChecklist: PropsChecklist;
  teleprompter: TeleprompterEntry[];
  shootingGroups: ShootingGroup[];
}

// ==================== 消息传递 ====================

/** 消息传递（Webview ↔ 扩展） */
export type MessageCommand =
  // V1 已有
  | { type: 'generate'; request: GenerateRequest }
  | { type: 'suggestSchedule'; request: ScheduleRequest }
  | { type: 'updateShots'; shots: Shot[] }
  | { type: 'updateShootingDay'; day: ShootingDay }
  | { type: 'exportMarkdown'; data: AppState }
  | { type: 'exportFeishu'; data: AppState }
  | { type: 'exportCSV'; data: AppState }
  | { type: 'setApiKey'; apiKey: string }
  | { type: 'showMessage'; text: string }
  | { type: 'generateResult'; shots: Shot[]; summary: string }
  | { type: 'scheduleResult'; day: ShootingDay }
  | { type: 'exportResult'; content: string; format: string }
  | { type: 'error'; message: string }
  // V2 新增
  | { type: 'generateV2'; request: GenerateRequestV2 }
  | { type: 'generateV2Result'; shots: Shot[]; props: PropItem[]; summary: string; teleprompter: TeleprompterEntry[] }
  | { type: 'analyzeVenue'; base64: string }
  | { type: 'analyzeVenueResult'; analysis: VenueAnalysis }
  | { type: 'analyzeProduct'; base64: string }
  | { type: 'analyzeProductResult'; analysis: ProductAnalysis }
  | { type: 'suggestSequence'; shots: Shot[] }
  | { type: 'suggestSequenceResult'; groups: ShootingGroup[] }
  | { type: 'generateTeleprompter'; shots: Shot[] }
  | { type: 'teleprompterResult'; entries: TeleprompterEntry[] }
  | { type: 'exportTeleprompter'; entries: TeleprompterEntry[]; lang: Lang }
  | { type: 'exportShootingList'; groups: ShootingGroup[]; props: PropsChecklist }
  | { type: 'exportPropsChecklist'; props: PropsChecklist }
  | { type: 'exportHostCards'; shots: Shot[] };
