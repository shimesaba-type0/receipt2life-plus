import { describe, expect, it } from "vitest";
import { recordBackup } from "../../src/core/backup-log";
import { listNotices } from "../../src/core/notices";
import { addTransactions } from "../../src/core/transactions";
import { testEnv } from "../helpers";

const NOW = new Date("2026-10-11T03:00:00Z");

describe("お知らせ", () => {
  it("データがなければ、何も出ない", async () => {
    expect(await listNotices(testEnv().DB, { now: NOW })).toEqual([]);
  });

  it("未バックアップのときと、30日以上たったときだけ、バックアップのお知らせが出る", async () => {
    const db = testEnv().DB;
    await addTransactions(db, { transactions: [{ date: "2026-10-01", amount: 100, merchant: "A店", category: "食費", account: "現金" }] }, { now: NOW });
    const first = await listNotices(db, { now: NOW });
    expect(first).toMatchObject([{ id: "backup", level: "warn", href: "/backup", body: "まだバックアップを取っていません。" }]);
    await recordBackup(db, { now: NOW });
    expect(await listNotices(db, { now: NOW })).toEqual([]);
    const later = await listNotices(db, { now: new Date("2026-11-12T03:00:00Z") });
    expect(later[0]?.body).toBe("最後のバックアップから32日たちました。");
  });
});
