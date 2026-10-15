import { describe, expect, it } from 'vitest';
import { AUTO_QUALITY, FrameMonitor } from '../src/render/quality';

/** Feed `seconds` of frames at a steady frame rate; returns how many downgrades were requested. */
function run(m: FrameMonitor, fps: number, seconds: number, eligible = true, workMs = 5): number {
  let downgrades = 0;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) if (m.frame(1 / fps, workMs, eligible)) downgrades++;
  return downgrades;
}

describe('automatic quality downgrade', () => {
  it('measures FPS from the real elapsed time, below the 10 fps a clamped step would allow', () => {
    const m = new FrameMonitor(0);
    run(m, 4, 2);
    expect(m.fps).toBeCloseTo(4, 5);
  });

  it('reports the measured work time per frame, not 1000 / FPS', () => {
    const m = new FrameMonitor(0);
    run(m, 60, 1, true, 3.5);
    expect(m.frameMs).toBeCloseTo(3.5, 5);
  });

  it('steps down after sustained slow frames, and only once per trigger period', () => {
    const m = new FrameMonitor(0);
    expect(run(m, 20, AUTO_QUALITY.triggerS - 1)).toBe(0);
    expect(run(m, 20, 1.01)).toBe(1);
    expect(m.lowTime).toBe(0);
  });

  it('does not step down when the frame rate is healthy', () => {
    const m = new FrameMonitor(0);
    expect(run(m, 60, 30)).toBe(0);
    expect(m.lowTime).toBe(0);
  });

  it('recovers slow time when frames are fast again', () => {
    const m = new FrameMonitor(0);
    run(m, 20, 3);
    run(m, 60, 3);
    expect(m.lowTime).toBe(0);
  });

  it('ignores frames slowed by seeking or replays, and the settle time after them', () => {
    const m = new FrameMonitor(0);
    // a long seek: very slow frames, flagged as not eligible
    expect(run(m, 5, 10, false)).toBe(0);
    expect(m.lowTime).toBe(0);
    // the first second after it is not sampled either, even if still slow
    expect(run(m, 20, AUTO_QUALITY.settleS)).toBe(0);
    expect(m.lowTime).toBe(0);
  });

  it('skips the window in which a disturbance happens', () => {
    const m = new FrameMonitor(0);
    run(m, 20, 2);
    const before = m.lowTime;
    expect(before).toBeGreaterThan(0);
    m.disturb();
    run(m, 20, AUTO_QUALITY.settleS);
    expect(m.lowTime).toBe(before);
    // sampling resumes after the settle time
    run(m, 20, 1);
    expect(m.lowTime).toBeGreaterThan(before);
  });

  it('does not sample the first second after start', () => {
    const m = new FrameMonitor();
    run(m, 10, AUTO_QUALITY.settleS);
    expect(m.lowTime).toBe(0);
  });
});
