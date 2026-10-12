// アイコン(バーコード柄)の小さな飾り。空の状態・読み込み中・見出しの隣などに、さりげなく添える(1画面に最大1つ)。
// 装飾なので、読み上げには出さない
export function BrandMark(props: { size?: number; faint?: boolean; class?: string }) {
  const { size = 20, faint = false } = props;
  return <img class={`brandmark${faint ? " brandmark--faint" : ""}${props.class ? ` ${props.class}` : ""}`} src="/brand/icon.svg" alt="" aria-hidden="true" width={size} height={size} />;
}
