// D1 の使用量(読んだ行数・書いた行数)。Cloudflare の GraphQL 分析 API から取る(ダッシュボードのグラフと同じデータ)。
// 読み取り専用。取得には「アカウントの分析を読むだけ」の API トークンが要る(人間が Cloudflare で作って、Worker のシークレットに入れる)。
// トークン・アカウントID・データベースIDは、コードにも画面にも出さない(エラーの文面にも含めない)。設定がなければ configured: false を返し、アプリはそのまま動く。

// Workers Free プランの D1 の上限(1日あたり。UTC の0時にリセット)。2026年時点の公式の値
export const FREE_ROWS_READ_PER_DAY = 5_000_000;
export const FREE_ROWS_WRITTEN_PER_DAY = 100_000;
// 上限に対する割合で、注意(warn)・危険(danger)を出す
export const WARN_RATIO = 0.7;
export const DANGER_RATIO = 0.9;
// 取得する日数(分析 API が持つのは直近31日)
export const USAGE_DAYS = 30;

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const TIMEOUT_MS = 5000;
const CACHE_MS = 5 * 60 * 1000;

export interface UsageEnv {
  CF_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  D1_DATABASE_ID?: string;
}

export interface UsageDay {
  // UTC の日付(YYYY-MM-DD)
  date: string;
  rows_read: number;
  rows_written: number;
  read_queries: number;
  write_queries: number;
}

export type UsageLevel = "ok" | "warn" | "danger";

export interface UsageMeter {
  used: number;
  limit: number;
  // 使用量÷上限(0〜。1を超えることもある)
  ratio: number;
  level: UsageLevel;
}

export type UsageResult =
  | { ok: true; configured: false; missing: string[]; message: string }
  | {
      ok: true;
      configured: true;
      // 古い順(UTC の日付)。データのない日は 0 で埋める
      days: UsageDay[];
      // 今日(UTC)
      today: UsageDay;
      rows_read: UsageMeter;
      rows_written: UsageMeter;
      // 2つのうち悪いほう
      level: UsageLevel;
      // 取得した時刻(ISO)。5分間は同じ結果を返す
      fetched_at: string;
      message: string;
    }
  | { ok: false; errors: { field: string; message: string }[] };

const REQUIRED = ["CF_API_TOKEN", "CF_ACCOUNT_ID", "D1_DATABASE_ID"] as const;

export const utcDate = (d: Date): string => d.toISOString().slice(0, 10);

const meter = (used: number, limit: number): UsageMeter => {
  const ratio = limit === 0 ? 0 : used / limit;
  return { used, limit, ratio, level: ratio >= DANGER_RATIO ? "danger" : ratio >= WARN_RATIO ? "warn" : "ok" };
};
const worse = (a: UsageLevel, b: UsageLevel): UsageLevel => (a === "danger" || b === "danger" ? "danger" : a === "warn" || b === "warn" ? "warn" : "ok");

// 分析 API の行(日付ごと)から、直近の日数ぶんを作る。欠けた日は 0 で埋める(純粋な関数。テストする)
export function buildUsage(rows: readonly UsageDay[], todayUtc: string, days = USAGE_DAYS): { days: UsageDay[]; today: UsageDay } {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: UsageDay[] = [];
  const end = Date.parse(`${todayUtc}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i--) {
    const date = utcDate(new Date(end - i * 86_400_000));
    out.push(byDate.get(date) ?? { date, rows_read: 0, rows_written: 0, read_queries: 0, write_queries: 0 });
  }
  return { days: out, today: out[out.length - 1]! };
}

const QUERY = `query D1Usage($accountTag: string!, $start: Date, $end: Date, $databaseId: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }, orderBy: [date_ASC]) {
        sum { readQueries writeQueries rowsRead rowsWritten }
        dimensions { date }
      }
    }
  }
}`;

interface GraphqlGroup {
  sum?: { readQueries?: number; writeQueries?: number; rowsRead?: number; rowsWritten?: number };
  dimensions?: { date?: string };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// 応答から日ごとの行を取り出す(同じ日が複数あれば足す。形が違えば null)
export function parseUsageRows(json: unknown): UsageDay[] | null {
  const groups = (json as { data?: { viewer?: { accounts?: { d1AnalyticsAdaptiveGroups?: GraphqlGroup[] }[] } } })?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(groups)) return null;
  const byDate = new Map<string, UsageDay>();
  for (const g of groups) {
    const date = g.dimensions?.date;
    if (typeof date !== "string" || !DATE.test(date)) continue;
    const cur = byDate.get(date) ?? { date, rows_read: 0, rows_written: 0, read_queries: 0, write_queries: 0 };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
    cur.rows_read += n(g.sum?.rowsRead);
    cur.rows_written += n(g.sum?.rowsWritten);
    cur.read_queries += n(g.sum?.readQueries);
    cur.write_queries += n(g.sum?.writeQueries);
    byDate.set(date, cur);
  }
  return [...byDate.values()];
}

const fail = (message: string): UsageResult => ({ ok: false, errors: [{ field: "usage", message }] });

let cache: { key: string; at: number; value: UsageResult } | null = null;
export const clearUsageCache = () => {
  cache = null;
};

export interface UsageOptions {
  // 外へ出る fetch(本番だけ渡す。テストでは差し替える)。省略すると、設定があっても取得できない
  fetchImpl?: typeof fetch;
  now?: Date;
}

export async function getUsage(env: UsageEnv, options: UsageOptions = {}): Promise<UsageResult> {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) {
    return { ok: true, configured: false, missing: [...missing], message: "使用量のグラフは、まだ設定されていません(docs/setup.md の「使用量のグラフ」を参照)" };
  }
  // 変数に取り出してから呼ぶ(Workers の fetch は、別のオブジェクトのメソッドとして呼ぶと Illegal invocation になる)
  const doFetch = options.fetchImpl;
  if (!doFetch) return fail("この環境では、使用量を取得できません");

  const now = options.now ?? new Date();
  const key = `${env.CF_ACCOUNT_ID}:${env.D1_DATABASE_ID}`;
  if (cache && cache.key === key && now.getTime() - cache.at < CACHE_MS && now.getTime() >= cache.at) return cache.value;

  const todayUtc = utcDate(now);
  const start = utcDate(new Date(Date.parse(`${todayUtc}T00:00:00Z`) - (USAGE_DAYS - 1) * 86_400_000));
  let res: Response;
  try {
    res = await doFetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { accountTag: env.CF_ACCOUNT_ID, start, end: todayUtc, databaseId: env.D1_DATABASE_ID } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return fail(timeout ? "Cloudflare が5秒以内に応答しませんでした" : "Cloudflare への通信に失敗しました");
  }
  if (res.status === 401 || res.status === 403) return fail(`Cloudflare が ${res.status} を返しました(API トークンの権限・有効期限を確認してください。必要なのは、アカウントの「アカウント分析:読み取り」)`);
  if (!res.ok) return fail(`Cloudflare が ${res.status} を返しました`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return fail("Cloudflare の応答を読み取れませんでした");
  }
  // GraphQL のエラー(権限不足・ID違いなど)は、文面だけ短く(トークン等は含まれない)
  const errors = (json as { errors?: { message?: string }[] | null })?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return fail(`Cloudflare の分析 API がエラーを返しました(${String(errors[0]?.message ?? "不明").slice(0, 120)})。アカウントID・データベースID・トークンの権限を確認してください`);
  }
  const rows = parseUsageRows(json);
  if (rows === null) return fail("Cloudflare の応答の形が想定と違います");

  const { days, today } = buildUsage(rows, todayUtc);
  const reads = meter(today.rows_read, FREE_ROWS_READ_PER_DAY);
  const writes = meter(today.rows_written, FREE_ROWS_WRITTEN_PER_DAY);
  const pct = (m: UsageMeter) => `${Math.round(m.ratio * 1000) / 10}%`;
  const value: UsageResult = {
    ok: true,
    configured: true,
    days,
    today,
    rows_read: reads,
    rows_written: writes,
    level: worse(reads.level, writes.level),
    fetched_at: now.toISOString(),
    message: `今日(UTC ${todayUtc})の D1: 読んだ行 ${today.rows_read.toLocaleString("ja-JP")}(上限の ${pct(reads)})、書いた行 ${today.rows_written.toLocaleString("ja-JP")}(上限の ${pct(writes)})`,
  };
  cache = { key, at: now.getTime(), value };
  return value;
}

// 上限のリセットは UTC の0時=日本時間の午前9時。画面では UTC の日付で出し、この時刻を添える
export const JST_RESET_HOUR = 9;
