import "server-only";

/*
 * 云端运行器的实时画面：运行器每 300ms 左右把截图 POST 上来，网页长轮询取最新一帧；
 * 网页上的点击、按键排进队列，随下一次截图的响应带回运行器。
 * 只放内存（单个 web 进程），任务结束 10 分钟后清掉。
 */

export type LiveInput =
  | { t: "click" | "dblclick"; x: number; y: number }
  | { t: "wheel"; dy: number }
  | { t: "type"; text: string }
  | { t: "key"; key: string }
  | { t: "back" };

type Live = {
  frame: Buffer | null;
  seq: number;
  url: string;
  width: number;
  height: number;
  inputs: LiveInput[];
  waiters: Set<() => void>;
  /** 最近一次有人在看画面 */
  viewedAt: number;
  touchedAt: number;
};

/** 没人看画面多久后让运行器结束任务 */
export const LIVE_IDLE_MS = 5 * 60_000;

const g = globalThis as unknown as { __matrixLive?: Map<string, Live> };
const store = (g.__matrixLive ??= new Map());

function entry(jobId: string): Live {
  let e = store.get(jobId);
  if (!e) {
    e = { frame: null, seq: 0, url: "", width: 0, height: 0, inputs: [], waiters: new Set(), viewedAt: Date.now(), touchedAt: Date.now() };
    store.set(jobId, e);
  }
  e.touchedAt = Date.now();
  return e;
}

function sweep() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, e] of store) if (e.touchedAt < cutoff) store.delete(id);
}

/** 运行器上传一帧（frame 为空 = 画面没变，只取输入） */
export function pushFrame(jobId: string, frame: Buffer | null, meta: { url: string; width: number; height: number }) {
  sweep();
  const e = entry(jobId);
  e.url = meta.url;
  if (meta.width && meta.height) {
    e.width = meta.width;
    e.height = meta.height;
  }
  if (frame?.length) {
    e.frame = frame;
    e.seq++;
    for (const w of e.waiters) w();
    e.waiters.clear();
  }
  const inputs = e.inputs.splice(0, 50);
  return { inputs, idle: Date.now() - e.viewedAt > LIVE_IDLE_MS };
}

/** 网页取帧：比 seq 新的立即返回，否则最多等 timeoutMs */
export async function waitFrame(jobId: string, seq: number, timeoutMs: number) {
  const e = entry(jobId);
  e.viewedAt = Date.now();
  if (e.seq <= seq) {
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        e.waiters.delete(done);
        resolve();
      };
      const t = setTimeout(done, timeoutMs);
      e.waiters.add(done);
    });
  }
  e.viewedAt = Date.now();
  return { frame: e.seq > seq ? e.frame : null, seq: e.seq, url: e.url, width: e.width, height: e.height };
}

export function pushInput(jobId: string, input: LiveInput) {
  const e = entry(jobId);
  e.viewedAt = Date.now();
  if (e.inputs.length < 200) e.inputs.push(input);
}
