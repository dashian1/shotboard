# Shotboard 字段定义

```typescript
type ShotCategory = 'empty' | 'talking' | 'product' | 'broll' | 'other';

interface HostDirection {
  tone: string;
  expression: string;
  gesture: string;
  eyeDirection: string;
  posture: string;
  emphasisWords: string[];
  breathingPoint: boolean;
  movement: string;
}

interface ShotboardRow {
  scriptTitle: string;         // 脚本名称
  scriptText: string;          // 脚本
  shotNo: number;              // 镜头
  status: string;              // 状态
  duration: number;            // 时长(秒)
  sceneName: string;           // 场景
  actorMakeup: string;         // 演员妆造
  wardrobeProps: string;       // 服化道
  shotType: string;            // 景别
  cameraMove: string;          // 运镜
  visual: string;              // 画面
  actionExpression: string;    // 动作神情
  dialogue: string;            // 口播稿
  subtitle: string;            // 字幕
  storyboardImage: string;     // 分镜图
  storyboardImageUrl: string;  // 分镜图链接
  videoUrl: string;            // 视频链接
  category: ShotCategory;
  props: string[];
  hostDirection: HostDirection | null;
}

interface PropSummary {
  name: string;
  forScenes: string[];
  totalQuantity: number;
  notes: string;
}

interface ShotboardResult {
  shots: ShotboardRow[];
  props: PropSummary[];
}
```
