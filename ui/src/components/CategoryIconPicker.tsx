import type { CategoryIconKey } from "../../../src/api/contract";
import { UI_CATEGORY_ICONS, categoryIconLabel } from "../categoryIcons";
import { CategoryIcon } from "./CategoryIcon";

// アイコンの選択。5列程度のグリッドのボタンで、選択中は aria-pressed と枠で示す。選んだものをもう一度押すと外れる(未設定)
export function CategoryIconPicker(props: { value: CategoryIconKey | null; onChange: (value: CategoryIconKey | null) => void; disabled?: boolean }) {
  const { value } = props;
  return (
    <fieldset class="cat-picker">
      <legend class="cat-picker__legend">アイコン</legend>
      <div class="cat-picker__grid">
        {UI_CATEGORY_ICONS.map((i) => {
          const selected = value === i.key;
          return (
            <button
              key={i.key}
              type="button"
              class={`cat-picker__btn${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              aria-label={i.label}
              title={i.label}
              disabled={props.disabled}
              onClick={() => props.onChange(selected ? null : i.key)}
            >
              <CategoryIcon icon={i.key} />
            </button>
          );
        })}
      </div>
      <p class="muted cat-picker__note" role="status">
        {value ? `選択中: ${categoryIconLabel(value)}(もう一度押すと外せます)` : "未設定(「その他」と同じ見た目になります)"}
      </p>
    </fieldset>
  );
}
