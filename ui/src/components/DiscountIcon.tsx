import { DISCOUNT_ICON } from "../icons";

// 割引の線画(値札と「%」)。装飾なので読み上げない。色は文字色(currentColor)に従う
export function DiscountIcon(props: { size?: number }) {
  const size = props.size ?? 18;
  return (
    <svg class="discount-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {DISCOUNT_ICON.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}
