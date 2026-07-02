import { AppState, Shot, ShootingDay, VideoType, Lang } from './types';

/**
 * 简单的状态管理
 */
export class Store {
  private state: AppState;
  private listeners: Array<(state: AppState) => void> = [];

  constructor() {
    this.state = this.getDefaultState();
  }

  private getDefaultState(): AppState {
    return {
      projectName: '',
      scriptText: '',
      shots: [],
      videoType: 'general',
      lang: 'zh',
      shootingDay: {
        date: new Date().toISOString().slice(0, 10),
        location: '',
        blocks: [],
        castList: [],
        equipmentList: [],
        budget: [],
        notes: '',
      },
      maxShots: 30,
      mediaInputs: [],
      propsChecklist: { byShot: [], byCategory: {} as any, totalNeeded: {} },
      teleprompter: [],
      shootingGroups: [],
    };
  }

  getState(): AppState {
    return this.state;
  }

  setShots(shots: Shot[]) {
    this.state.shots = shots;
    this.notify();
  }

  setShootingDay(day: ShootingDay) {
    this.state.shootingDay = day;
    this.notify();
  }

  setScriptText(text: string) {
    this.state.scriptText = text;
  }

  setVideoType(type: VideoType) {
    this.state.videoType = type;
  }

  setLang(lang: Lang) {
    this.state.lang = lang;
  }

  subscribe(listener: (state: AppState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  reset() {
    this.state = this.getDefaultState();
    this.notify();
  }
}
