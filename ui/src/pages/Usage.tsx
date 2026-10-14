import { useEffect, useState } from "preact/hooks";
import type { UsageData, UsageDayView, UsageMeterView } from "../../../src/api/contract";
import { getUsage } from "../api";
import { errorText } from "./categoriesLogic";
import { LEVEL_LABELS, barWidth, dayBars, limitLine, meterText, percentText, shortDay } from "./usageLogic";
import "./Categories.css";
import "./Usage.css";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: UsageData };

// D1 の使用量(無料プランの上限に対して、どれだけ使っているか)。Cloudflare の分析 API から取る
export function Usage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getUsage()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setState({ kind: "ready", data: res });
        else setState({ kind: "error", message: errorText(res.errors) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : "読み込めませんでした。" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <section class="page cat usage" aria-labelledby="usage-title">
      <header class="cat__header">
        <h1 id="usage-title" class="cat__title">
          使用量
        </h1>
        <p class="cat__lead">データベース(D1)を、今日どれだけ使ったかです。無料プランの上限は、1日あたり(UTCの0時=日本時間の午前9時にリセット)です。</p>
      </header>

      {state.kind === "loading" && (
        <p class="muted cat__status" role="status">
          読み込み中です…
        </p>
      )}
      {state.kind === "error" && (
        <div class="cat__status" role="alert">
          <p class="error">{state.message}</p>
          <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>
            もう一度読み込む
          </button>
        </div>
      )}
      {state.kind === "ready" && !state.data.configured && <NotConfigured missing={state.data.missing} />}
      {state.kind === "ready" && state.data.configured && <Ready data={state.data} />}
    </section>
  );
}

function NotConfigured(props: { missing: string[] }) {
  return (
    <div class="card usage__card">
      <h2 class="usage__h2">まだ設定されていません</h2>
      <p>使用量を見るには、Cloudflare で「アカウント分析を読むだけ」のトークンを作って、Worker のシークレットに入れます(1回だけ)。手順は、リポジトリの docs/setup.md の「使用量のグラフ」にあります。</p>
      <p class="muted">足りない設定: {props.missing.join("、")}</p>
      <p class="muted">設定しなくても、アプリはそのまま使えます。Cloudflare のダッシュボードの「D1 → データベース → Metrics」でも、同じ数字が見られます。</p>
    </div>
  );
}

function Meter(props: { label: string; m: UsageMeterView }) {
  const { m } = props;
  return (
    <div class="usage__meter">
      <div class="usage__meter-head">
        <span>{props.label}</span>
        <span class="num">
          {meterText(m)}({percentText(m.ratio)})
        </span>
      </div>
      <div class="usage__track" role="img" aria-label={`${props.label} 上限の ${percentText(m.ratio)}。${LEVEL_LABELS[m.level]}`}>
        <div class={`usage__fill is-${m.level}`} style={{ width: `${barWidth(m.ratio)}%` }} />
      </div>
      <span class={`usage__level is-${m.level}`}>{LEVEL_LABELS[m.level]}</span>
    </div>
  );
}

function Chart(props: { title: string; days: UsageDayView[]; pick: (d: UsageDayView) => number; limit: number; unit: string }) {
  const bars = dayBars(props.days, props.pick, props.limit);
  const line = limitLine(props.days, props.pick, props.limit);
  return (
    <div class="card usage__card">
      <h2 class="usage__h2">{props.title}</h2>
      <p class="muted usage__note">直近30日(UTCの日付)。横の線が、1日の上限({props.limit.toLocaleString("ja-JP")}{props.unit})です。</p>
      <div class="usage__chart" role="img" aria-label={`${props.title}の日ごとの推移。上限の線つき`}>
        <div class="usage__limit" style={{ bottom: `${line}%` }} />
        {bars.map((b) => (
          <div key={b.date} class="usage__col" title={`${shortDay(b.date)}: ${b.value.toLocaleString("ja-JP")}${props.unit}`}>
            <div class={`usage__bar${b.over ? " is-over" : ""}`} style={{ height: `${b.height}%` }} />
          </div>
        ))}
      </div>
      <div class="usage__axis muted">
        <span>{shortDay(bars[0]?.date ?? "")}</span>
        <span>{shortDay(bars[bars.length - 1]?.date ?? "")}</span>
      </div>
    </div>
  );
}

function Ready(props: { data: Extract<UsageData, { configured: true }> }) {
  const { data } = props;
  return (
    <>
      <div class="card usage__card">
        <h2 class="usage__h2">今日({shortDay(data.today.date)}・UTC)</h2>
        <Meter label="読んだ行" m={data.rows_read} />
        <Meter label="書いた行" m={data.rows_written} />
        <p class="muted usage__note">
          問い合わせの回数: 読み {data.today.read_queries.toLocaleString("ja-JP")}回、書き {data.today.write_queries.toLocaleString("ja-JP")}回。上限を超えると、その日は D1 に問い合わせできず、アプリが使えなくなります(請求はされません。リセットで戻ります)。
        </p>
      </div>
      <Chart title="読んだ行" days={data.days} pick={(d) => d.rows_read} limit={data.rows_read.limit} unit="行" />
      <Chart title="書いた行" days={data.days} pick={(d) => d.rows_written} limit={data.rows_written.limit} unit="行" />
      <p class="muted usage__note">Cloudflare の分析 API から取得({new Date(data.fetched_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })} 時点。5分ごとに更新)。数字は Cloudflare の課金・上限と同じ集計です。</p>
    </>
  );
}
