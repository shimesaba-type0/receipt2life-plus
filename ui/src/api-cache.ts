// 画面側の短時間キャッシュ(メモリだけ。ページを読み込み直すと消える)。
// 同じ月・同じ日を見直すとき、すぐ表示するためのもの。サーバーの応答は「保存しない」のまま(共有の保存先には残さない)。
// - 成功した GET だけを、TTL の間おぼえる(失敗はおぼえない=「もう一度読み込む」は必ず取りに行く)
// - 書き込み(POST/PATCH/DELETE、写真、インポート)をしたら、すべて捨てる(自分の変更は必ず反映される)
// - 同じ GET が飛行中なら、1回の通信を共有する
// - 他の端末や MCP からの書き込みは、TTL の間は見えないことがある(その間だけ)

export const CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 100;

interface Entry<T> {
  at: number;
  value: T;
}

export class ShortCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();
  // 書き込みで捨てた時点より前に始まった通信の結果は、保存しない(古い値を戻さない)
  private generation = 0;

  constructor(
    private readonly ttlMs: number = CACHE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** key の値を返す。おぼえていて新しければそれを、なければ load を呼ぶ。isOk が false の結果はおぼえない */
  async get(key: string, load: () => Promise<T>, isOk: (value: T) => boolean): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    if (hit) this.entries.delete(key);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const gen = this.generation;
    const p = load()
      .then((value) => {
        if (gen === this.generation && isOk(value)) this.remember(key, value);
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === p) this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  /** すべて捨てる(書き込みのあと) */
  clear(): void {
    this.generation++;
    this.entries.clear();
    this.inflight.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private remember(key: string, value: T): void {
    if (this.entries.size >= MAX_ENTRIES) {
      // いちばん古いものを1件捨てる(Map は挿入順)
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: this.now(), value });
  }
}
