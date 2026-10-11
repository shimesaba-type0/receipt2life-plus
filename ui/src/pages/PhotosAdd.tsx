import { useState } from "preact/hooks";
import { PhotoUploader } from "../components/PhotoUploader";
import type { PhotosAddTarget } from "../route";
import { Link } from "../router";
import "./PhotosAdd.css";

// "2026-10-11" → "10月11日"
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

// リンク(AIが作る /photos/add?...)が正しくないときの画面
function InvalidLink() {
  return (
    <section class="page photos-add" aria-labelledby="photos-add-title">
      <h1 class="page__title" id="photos-add-title">
        写真を追加
      </h1>
      <div class="card photos-add__error" role="alert">
        <p>リンクが正しくありません。AIにもう一度リンクを作ってもらってください。</p>
        <Link href="/" class="btn btn--primary photos-add__btn">
          ホームへ戻る
        </Link>
      </div>
    </section>
  );
}

// 写真を追加する画面。紐づけ先(日付・取引・出来事)はURLのクエリで決まる
export function PhotosAdd(props: { target: PhotosAddTarget | null }) {
  const { target } = props;
  const [added, setAdded] = useState(0);
  const [done, setDone] = useState(false);
  const [clearSignal, setClearSignal] = useState(0);
  if (!target) return <InvalidLink />;

  const links = [target.transaction_id ? "支出に紐づけます" : null, target.event_id ? "出来事に紐づけます" : null].filter((s): s is string => s !== null);

  return (
    <section class="page photos-add" aria-labelledby="photos-add-title">
      <h1 class="page__title" id="photos-add-title">
        写真を追加
      </h1>
      <p class="photos-add__target">
        {formatMonthDay(target.date)}の写真として追加します{links.length > 0 && `。${links.join("。")}`}
      </p>
      {target.caption && <p class="muted photos-add__caption">説明: {target.caption}</p>}

      <PhotoUploader
        meta={target}
        addLabel="写真を選ぶ"
        clearSignal={clearSignal}
        onStart={() => setDone(false)}
        onDone={({ ok }) => {
          if (ok > 0) {
            setAdded(ok);
            setDone(true);
          }
        }}
      />

      {done && (
        <div class="card photos-add__done" role="status">
          <p class="photos-add__done-msg">{added}枚追加しました</p>
          <div class="photos-add__actions">
            <Link href={`/day/${target.date}`} class="btn btn--primary photos-add__btn">
              この日を開く
            </Link>
            <button
              type="button"
              class="btn photos-add__btn"
              onClick={() => {
                setDone(false);
                setClearSignal((n) => n + 1);
              }}
            >
              続けて追加
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
