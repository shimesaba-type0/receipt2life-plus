import type { CoreOptions } from "./transactions";

// バックアップ(JSONL の書き出し)の履歴。最後に書き出した日から日数がたったら、ホームで知らせる
// 件数は最新の50件だけ残す(古いものは消す)

export const BACKUP_REMIND_DAYS = 30;
const KEEP = 50;

export interface BackupStatus {
  last_backup_at: string | null;
  days_since: number | null;
  has_data: boolean;
  remind: boolean;
}

export async function recordBackup(db: D1Database, options: CoreOptions = {}): Promise<void> {
  const at = (options.now ?? new Date()).toISOString();
  await db.batch([
    db.prepare("INSERT INTO backup_log (id, created_at) VALUES (?, ?)").bind(`bk_${crypto.randomUUID()}`, at),
    db.prepare("DELETE FROM backup_log WHERE id NOT IN (SELECT id FROM backup_log ORDER BY created_at DESC LIMIT ?)").bind(KEEP),
  ]);
}

export async function getBackupStatus(db: D1Database, options: CoreOptions = {}): Promise<BackupStatus> {
  const now = options.now ?? new Date();
  const last = await db.prepare("SELECT MAX(created_at) AS at FROM backup_log").first<{ at: string | null }>();
  const data = await db.prepare("SELECT 1 AS x FROM transactions LIMIT 1").first();
  const at = last?.at ?? null;
  const days = at === null ? null : Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000));
  const hasData = data !== null;
  return { last_backup_at: at, days_since: days, has_data: hasData, remind: hasData && (days === null || days >= BACKUP_REMIND_DAYS) };
}
