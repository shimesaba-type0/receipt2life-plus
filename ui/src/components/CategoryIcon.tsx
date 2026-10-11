import { CATEGORY_ICON_PATHS } from "../categoryIconPaths";
import { resolveCategoryIcon } from "../categoryIcons";

// カテゴリのアイコン。24px の枠の線画で、色は文字色(currentColor)に従う。装飾なので読み上げない(aria-hidden)
// 未設定(null)・知らないキーは「その他」(・・・)
export function CategoryIcon(props: { icon: string | null | undefined; size?: number; class?: string }) {
  const size = props.size ?? 24;
  return (
    <svg
      class={props.class ? `cat-icon ${props.class}` : "cat-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {CATEGORY_ICON_PATHS[resolveCategoryIcon(props.icon)].map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

// 支出の行・明細のカテゴリチップ。先頭に小さなアイコン(16px)を付けて、文字は残す。icon が null なら文字だけ
export function CategoryChip(props: { label: string; icon: string | null; class?: string }) {
  return (
    <span class={`chip${props.icon ? " chip--cat" : ""}${props.class ? ` ${props.class}` : ""}`}>
      {props.icon && <CategoryIcon icon={props.icon} size={16} />}
      {props.label}
    </span>
  );
}
