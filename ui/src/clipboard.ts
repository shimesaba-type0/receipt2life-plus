// 「コピー」ボタンの動き(DOMに触れない部分。テストする)

export type CopyOutcome = "copied" | "selected";

export interface ClipboardLike {
  writeText: (text: string) => Promise<void>;
}

/**
 * テキストをクリップボードに入れる。使えない(未対応・権限なし・http など)とき、または失敗したときは、
 * select() でテキストを選択状態にして "selected" を返す(利用者が長押しなどでコピーできる)。
 */
export async function copyOrSelect(text: string, clipboard: ClipboardLike | undefined, select: () => void): Promise<CopyOutcome> {
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return "copied";
    } catch {
      // 選択に切り替える
    }
  }
  select();
  return "selected";
}

export function copyMessage(outcome: CopyOutcome, label: string): string {
  return outcome === "copied" ? `${label}をコピーしました` : `コピーできないため、${label}を選択しました。長押しなどでコピーしてください`;
}
