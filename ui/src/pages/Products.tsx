import { useEffect, useState } from "preact/hooks";
import type { ProductHistoryData, ProductRowView, ProductsData } from "../../../src/api/contract";
import { getProductHistory, getProducts } from "../api";
import { addMonths, formatMonthJa, formatYen, monthOf, monthRange, todayJst } from "../format";
import { Link, navigate } from "../router";
import { errorText } from "./categoriesLogic";
import { DEFAULT_PER, PER_OPTIONS, contentTotalText, diffText, pageOf, monthlyCells, perLabel, quantityBar, quantityText, unitPriceLabel, withPrevious } from "./productsLogic";
import { readPer, savePer } from "./productsStorage";
import "./Categories.css";
import "./Products.css";

// 商品ごとの購入数・単価。「今月、牛乳を何本買ったか」「卵の値段の推移」。明細に商品の情報がある行が対象
export function Products(props: { month: string | null; product: string | null }) {
  return props.product ? <Detail product={props.product} /> : <List month={props.month ?? monthOf(todayJst())} />;
}

type ListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; current: ProductsData; previous: ProductsData };

function List(props: { month: string }) {
  const { month } = props;
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    setPage(1);
    const query = (m: string) => {
      const r = monthRange(m);
      return `from=${r.from}&to=${r.to}&limit=200&sort=frequency`;
    };
    Promise.all([getProducts(query(month)), getProducts(query(addMonths(month, -1)))])
      .then(([cur, prev]) => {
        if (cancelled) return;
        if (cur.ok && prev.ok) setState({ kind: "ready", current: cur, previous: prev });
        else setState({ kind: "error", message: errorText((!cur.ok ? cur : (prev as { ok: false; errors: never[] })).errors) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : "読み込めませんでした。" });
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const go = (m: string) => navigate(`/products?month=${m}`);
  const rows: (ProductRowView & { previous: number; diff: number })[] =
    state.kind === "ready" ? withPrevious(state.current.products, state.previous.products).filter((p) => filter.trim() === "" || p.product.includes(filter.trim())) : [];
  const shown = pageOf(rows, page);

  return (
    <section class="page cat prod" aria-labelledby="prod-title">
      <header class="cat__header">
        <h1 id="prod-title" class="cat__title">
          商品
        </h1>
        <p class="cat__lead">明細の商品ごとに、買った数と金額を月ごとに見ます。商品を押すと、単価の推移が見られます。</p>
      </header>

      <div class="prod__month">
        <button type="button" class="btn prod__nav" aria-label="前の月" onClick={() => go(addMonths(month, -1))}>
          ‹
        </button>
        <strong>{formatMonthJa(month)}</strong>
        <button type="button" class="btn prod__nav" aria-label="次の月" disabled={month >= monthOf(todayJst())} onClick={() => go(addMonths(month, 1))}>
          ›
        </button>
      </div>

      {state.kind === "loading" && (
        <p class="muted cat__status" role="status">
          読み込み中です…
        </p>
      )}
      {state.kind === "error" && (
        <p class="error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "ready" && (
        <>
          <label class="sr-only" for="prod-filter">
            商品名で絞り込む
          </label>
          <input id="prod-filter" class="prod__filter" type="search" placeholder="商品名で絞り込む" value={filter} onInput={(e) => {
              setFilter((e.currentTarget as HTMLInputElement).value);
              setPage(1);
            }}
          />
          {rows.length === 0 ? (
            <p class="muted">
              {state.current.total === 0
                ? "この月の商品はありません。明細(レシートの行)のある支出が対象です。AI に「レシートを明細つきで登録して」と頼むと、商品ごとに集計できます。"
                : "当てはまる商品はありません。"}
            </p>
          ) : (
            <ul class="prod__list">
              {shown.rows.map((p) => (
                <li key={p.product} class="prod__item">
                  <Link href={`/products?product=${encodeURIComponent(p.product)}`} class="prod__link">
                    <span class="prod__name">{p.product}</span>
                    <span class="prod__qty num">{quantityText(p.quantity)}</span>
                    <span class="prod__amount num muted">{formatYen(p.amount)}</span>
                    <span class="prod__diff muted">{[contentTotalText(p.content_total), diffText(p)].filter(Boolean).join(" ・ ")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shown.pages > 1 && (
            <nav class="prod__pager" aria-label="ページ">
              <button type="button" class="btn" disabled={shown.page <= 1} onClick={() => setPage(shown.page - 1)}>
                ‹ 前へ
              </button>
              <span class="muted">
                {shown.page} / {shown.pages}(全{rows.length}商品)
              </span>
              <button type="button" class="btn" disabled={shown.page >= shown.pages} onClick={() => setPage(shown.page + 1)}>
                次へ ›
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

type DetailState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: ProductHistoryData };

function Detail(props: { product: string }) {
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [perVersion, setPerVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    getProductHistory(props.product)
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
  }, [props.product]);

  return (
    <section class="page cat prod" aria-labelledby="prod-title">
      <header class="cat__header">
        <Link href="/products" class="prod__back">
          ‹ 商品の一覧
        </Link>
        <h1 id="prod-title" class="cat__title">
          {props.product}
        </h1>
        {state.kind === "ready" && state.data.jan_codes.length > 0 && <p class="muted prod__jan num">JAN {state.data.jan_codes.join("、")}</p>}
      </header>
      {state.kind === "loading" && (
        <p class="muted cat__status" role="status">
          読み込み中です…
        </p>
      )}
      {state.kind === "error" && (
        <p class="error" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "ready" && state.data.lines === 0 && <p class="muted">この商品の購入はありません。</p>}
      {state.kind === "ready" && state.data.lines > 0 && <DetailBody data={state.data} perVersion={perVersion} onPer={() => setPerVersion((n) => n + 1)} />}
    </section>
  );
}

function DetailBody(props: { data: ProductHistoryData; perVersion: number; onPer: () => void }) {
  const { data } = props;
  const unit = data.unit_price?.unit;
  // perVersion は、単位の選択が変わったときに再描画するため(選択は localStorage に覚える)
  void props.perVersion;
  const per = unit ? (readPer(unit) ?? DEFAULT_PER[unit]) : null;
  const cells = monthlyCells(data.months, monthOf(todayJst()), 12, addMonths);
  const max = Math.max(...cells.map((c) => c.quantity), 0);

  return (
    <>
      <div class="card prod__card">
        <div class="prod__sum">
          <div>
            <span class="muted">買った数(合計)</span>
            <strong class="num">{quantityText(data.quantity)}</strong>
          </div>
          <div>
            <span class="muted">買った回数</span>
            <strong class="num">{data.lines}回</strong>
          </div>
          <div>
            <span class="muted">金額(合計)</span>
            <strong class="num">{formatYen(data.amount)}</strong>
          </div>
        </div>
      </div>

      {data.unit_price && unit && per !== null && (
        <div class="card prod__card">
          <h2 class="prod__h2">単価</h2>
          {PER_OPTIONS[unit].length > 1 && (
            <div class="prod__chips" role="group" aria-label="単価の表示の単位">
              {PER_OPTIONS[unit].map((p) => (
                <button
                  key={p}
                  type="button"
                  class={`prod__chip${per === p ? " is-on" : ""}`}
                  aria-pressed={per === p}
                  onClick={() => {
                    savePer(unit, p);
                    props.onPer();
                  }}
                >
                  {perLabel(unit, p)}あたり
                </button>
              ))}
            </div>
          )}
          <ul class="prod__prices">
            <li>
              <span class="muted">最新</span> <strong class="num">{unitPriceLabel({ per_unit: data.unit_price.latest.per_unit, unit }, per)}</strong> <span class="muted">({data.unit_price.latest.date})</span>
            </li>
            <li>
              <span class="muted">最安</span> <strong class="num">{unitPriceLabel({ per_unit: data.unit_price.cheapest.per_unit, unit }, per)}</strong>{" "}
              <span class="muted">
                ({data.unit_price.cheapest.date}
                {data.unit_price.cheapest.merchant ? `・${data.unit_price.cheapest.merchant}` : ""})
              </span>
            </li>
            <li>
              <span class="muted">平均</span> <strong class="num">{unitPriceLabel({ per_unit: data.unit_price.average, unit }, per)}</strong>
            </li>
          </ul>
        </div>
      )}

      <div class="card prod__card">
        <h2 class="prod__h2">月ごと(直近12か月)</h2>
        <table class="prod__table">
          <thead>
            <tr>
              <th scope="col">月</th>
              <th scope="col">買った数</th>
              <th scope="col" class="num">
                金額
              </th>
              {unit && (
                <th scope="col" class="num">
                  単価
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {[...cells].reverse().map((c) => (
              <tr key={c.month} class={c.bought ? "" : "is-empty"}>
                <th scope="row">{Number(c.month.slice(5))}月</th>
                <td>
                  <div class="prod__bar-wrap">
                    <div class="prod__bar" style={{ width: `${quantityBar(c.quantity, max)}%` }} />
                    <span class="num">{c.bought ? quantityText(c.quantity) : "—"}</span>
                  </div>
                </td>
                <td class="num">{c.bought ? formatYen(c.amount) : "—"}</td>
                {unit && <td class="num">{c.unit_price && per !== null ? unitPriceLabel(c.unit_price, per).replace(/^.*あたり /, "") : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="card prod__card">
        <h2 class="prod__h2">買い物の記録</h2>
        <ul class="prod__purchases">
          {data.purchases.map((p, i) => (
            <li key={`${p.transaction_id}-${i}`}>
              <Link href={`/tx/${encodeURIComponent(p.transaction_id)}`} class="prod__purchase">
                <span class="prod__date">{p.date.slice(5).replace("-", "/")}</span>
                <span class="prod__merchant">{p.merchant ?? "(店名なし)"}</span>
                <span class="num">{formatYen(p.amount)}</span>
                <span class="muted prod__sub">
                  {p.name}
                  {p.quantity !== 1 ? ` ×${quantityText(p.quantity)}` : ""}
                  {p.unit_price ? ` ・ ${unitPriceLabel(p.unit_price, per)}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
