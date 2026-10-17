import { describe, expect, it } from "vitest";
import { getBackupStatus, recordBackup } from "../../src/core/backup-log";
import { testEnv } from "../helpers";
import { addTransactions } from "../../src/core/transactions";

const NOW = new Date("2026-10-11T03:00:00Z");

describe("バックアップの履歴", () => {
  it("記録がなく、データもなければ、お知らせは出さない", async () => {
    const s = await getBackupStatus(testEnv().DB, { now: NOW });
    expect(s).toEqual({ last_backup_at: null, days_since: null, has_data: false, remind: false });
  });

  it("データがあって未バックアップなら、お知らせを出す。書き出した直後は出さず、30日で出す", async () => {
    const db = testEnv().DB;
    await addTransactions(db, { transactions: [{ date: "2026-10-01", amount: 100, merchant: "A店", category: "食費", account: "現金" }] }, { now: NOW });
    expect((await getBackupStatus(db, { now: NOW })).remind).toBe(true);
    await recordBackup(db, { now: NOW });
    const fresh = await getBackupStatus(db, { now: NOW });
    expect(fresh).toMatchObject({ days_since: 0, remind: false });
    expect((await getBackupStatus(db, { now: new Date("2026-11-09T03:00:00Z") })).remind).toBe(false);
    expect(await getBackupStatus(db, { now: new Date("2026-11-10T03:00:00Z") })).toMatchObject({ days_since: 30, remind: true });
  });

  it("古い記録は50件を超えたら消す", async () => {
    const db = testEnv().DB;
    for (let i = 0; i < 52; i++) await recordBackup(db, { now: new Date(NOW.getTime() + i * 1000) });
    const n = await db.prepare("SELECT COUNT(*) AS n FROM backup_log").first<{ n: number }>();
    expect(n?.n).toBe(50);
  });
});
