import { getBackupStatus } from "./backup-log";
import type { UsageResult } from "./usage";
import type { CoreOptions } from "./transactions";

// ヘッダーの「お知らせ」に出す内容。保存はせず、そのときの状態から作る(解決すると消える)
// お知らせの種類を増やすときは、ここに足す。href は、押したときに開く画面

export interface Notice {
  id: string;
  level: "info" | "warn" | "danger";
  title: string;
  body: string;
  href: string;
}

export interface NoticeOptions extends CoreOptions {
  // D1 の使用量(取れたときだけ渡す。上限に近いときに、お知らせを出す)
  usage?: UsageResult;
}

const percent = (ratio: number): string => `${Math.round(ratio * 1000) / 10}%`;

export async function listNotices(db: D1Database, options: NoticeOptions = {}): Promise<Notice[]> {
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
  const usage = options.usage;
  if (usage?.ok && usage.configured && usage.level !== "ok") {
    const worse = usage.rows_written.ratio >= usage.rows_read.ratio ? { name: "書いた行", m: usage.rows_written } : { name: "読んだ行", m: usage.rows_read };
    notices.push({
      id: "usage",
      level: usage.level === "danger" ? "danger" : "warn",
      title: usage.level === "danger" ? "D1 の今日の使用量が、上限に近づいています" : "D1 の今日の使用量が、増えています",
      body: `${worse.name}が上限の ${percent(worse.m.ratio)} です。`,
      href: "/usage",
    });
  }
  return notices;
}
