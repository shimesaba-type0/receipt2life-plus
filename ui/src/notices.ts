import { useEffect, useState } from "preact/hooks";
import type { NoticeView } from "../../src/api/contract";
import { getNotices } from "./api";

// ヘッダーの「お知らせ」の状態。画面のどこからでも同じ内容を見られるよう、ここで1つ持つ

let current: NoticeView[] = [];
const listeners = new Set<(n: NoticeView[]) => void>();

export function refreshNotices(): void {
  getNotices()
    .then((res) => {
      if (!res.ok) return;
      current = res.notices;
      for (const fn of listeners) fn(current);
    })
    .catch(() => undefined);
}

export function useNotices(): NoticeView[] {
  const [value, setValue] = useState(current);
  useEffect(() => {
    listeners.add(setValue);
    setValue(current);
    return () => void listeners.delete(setValue);
  }, []);
  return value;
}
