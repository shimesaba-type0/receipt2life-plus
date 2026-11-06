// 席の評価の表示。星(作品の評価)と見分けるため、椅子のアイコンで出す(5つのうち、評価の数だけ塗る)
export function ChairIcon(props: { filled?: boolean }) {
  return (
    <svg class={`chair${props.filled ? " is-filled" : ""}`} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M7 3h10a2 2 0 0 1 2 2v7H5V5a2 2 0 0 1 2-2z" fill="currentColor" />
      <path d="M2.5 11a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v3h11v-3a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v6.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2.5 17.5z" fill="currentColor" />
      <path d="M6 20h2v2H6zM16 20h2v2h-2z" fill="currentColor" />
    </svg>
  );
}

export function SeatChairs(props: { value: number | null }) {
  const n = props.value ?? 0;
  return (
    <span class="chairs" role="img" aria-label={n ? `席の評価 5段階の${n}` : "席の評価なし"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <ChairIcon key={i} filled={i <= n} />
      ))}
    </span>
  );
}
