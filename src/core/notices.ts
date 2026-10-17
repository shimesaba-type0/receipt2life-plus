import { getBackupStatus } from "./backup-log";
import type { CoreOptions } from "./transactions";

// ヘッダーの「お知らせ」に出す内容。保存はせず、そのときの状態から作る(解決すると消える)
// お知らせの種類を増やすときは、ここに足す。href は、押したときに開く画面

export interface Notice {
  id: string;
  level: "info" | "warn";
  title: string;
  body: string;
  href: string;
}

export async function listNotices(db: D1Database, options: CoreOptions = {}): Promise<Notice[]> {
  const notices: Notice[] = [];
  const backup = await getBackupStatus(db, options);
  if (backup.remind) {
    notices.push({
      id: "backup",
      level: "warn",
      title: "バックアップを取りましょう",
      body: backup.days_since === null ? "まだバックアップを取っていません。" : `最後のバックアップから${backup.days_since}日たちました。`,
      href: "/backup",
    });
  }
  return notices;
}
