import { useEffect } from "preact/hooks";
import type { PhotoView } from "../../../src/api/contract";
import { photoUrl } from "../api";
import "../pages/Day.css";

// 写真の拡大表示(見るだけ。背景のタップ・Esc・「閉じる」で閉じる)。見た目は日の画面の拡大表示と同じ
export function PhotoLightbox(props: { photo: PhotoView; onClose: () => void }) {
  const { photo, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div class="day__lightbox" role="dialog" aria-modal="true" aria-label="写真の拡大表示" onClick={onClose}>
      <img src={photoUrl(photo.id)} alt={photo.caption ?? ""} onClick={(e) => e.stopPropagation()} />
      <div class="day__lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
