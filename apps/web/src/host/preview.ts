// 動画の停止中はポスターだけを見せる。画面を離れた場合もデコードを続けない。
export class PreviewMotion {
  private observer: IntersectionObserver | null = null;
  private readonly visible = new Set<HTMLVideoElement>();
  private videos: HTMLVideoElement[] = [];
  private active = true;
  private readonly motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  private readonly connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;

  constructor() {
    document.addEventListener('visibilitychange', this.sync);
    this.motion?.addEventListener('change', this.sync);
    this.connection?.addEventListener('change', this.sync);
  }

  replace(root: HTMLElement): void {
    this.observer?.disconnect();
    for (const video of this.videos) video.pause();
    this.visible.clear();
    this.videos = [...root.querySelectorAll<HTMLVideoElement>('video')].slice(0, 12);
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const video = entry.target.querySelector('video');
          if (!video) continue;
          if (entry.isIntersecting) this.visible.add(video);
          else this.visible.delete(video);
        }
        this.sync();
      });
      for (const video of this.videos) this.observer.observe(video.parentElement!);
    }
    this.sync();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.sync();
  }

  private readonly sync = (): void => {
    const stopped = !this.active || document.hidden || this.motion?.matches || this.connection?.saveData;
    for (const video of this.videos) {
      const play = !stopped && video.isConnected && this.visible.has(video);
      video.hidden = !play;
      if (play) void video.play().catch(() => { video.hidden = true; });
      else video.pause();
    }
  };
}
