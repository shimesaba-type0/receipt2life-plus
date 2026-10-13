import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addSubscription,
  deleteSubscription,
  deleteSubscriptionSchema,
  listSubscriptions,
  listSubscriptionsFieldsSchema,
  subscriptionFieldsSchema,
  updateSubscription,
  updateSubscriptionFieldsSchema,
} from "../../core/subscriptions";
import { toResult } from "../result";

// サブスク・保険などの固定費のツール: add_subscription / list_subscriptions / update_subscription / delete_subscription
// 支出の記録(add_transactions)とは別枠。ここに登録しても支出には数えない
export function registerSubscriptionTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "add_subscription",
    {
      title: "サブスク・固定費を登録する",
      description: [
        "サブスク(動画・音楽の配信など)、保険、その他の固定費を1件登録する。支出の記録(add_transactions)とは別枠の一覧で、ここに登録しても支出には数えない(実際に払った分は、レシートとして add_transactions で記録する)。",
        "必須は name(名前)、period(monthly=月払い / yearly=年払い)と、金額。円払いなら amount(1回の支払い額。円・整数)。amount は period に合わせる: 月払いなら月額、年払いなら年額(月額に割らない)。",
        "ドルなどの外貨払い(ChatGPT Plus など)は、currency(USD / EUR / GBP / AUD / CAD)と foreign_amount(外貨の金額。例: 20 や 4.99。period に合わせる)と exchange_rate(1外貨=何円。例: 150)を渡す。amount は渡さない(円は foreign_amount × exchange_rate の四捨五入で、月あたり・年あたりの合計を出すための目安になる)。実際の引き落とし額は、カードの明細の円(レートと手数料はカード会社が決める)なので、引き落とされたら支出(レシート)として add_transactions で記録する。レートは利用者が決める目安なので、確かでなければ利用者に聞き、為替が大きく動いたら update_subscription の exchange_rate で直す。",
        "kind は subscription=サブスク(既定) / insurance=保険 / other=その他の固定費。年払いなら billing_month(支払う月、1〜12)も分かれば入れる(次の更新月の目安になる)。billing_day(支払う日)、url(料金ページなど。https)、note(プラン名など)は任意。",
        "登録前に list_subscriptions で既存を確かめて、同じものを二重に作らない。金額は変わることがあるので、公式の料金ページで調べた最新の金額を入れ、確認できなければ利用者に聞く。調べた根拠のURLがあれば url に入れる。",
        "成功すると、登録した内容(id、月あたり・年あたりに直した金額つき)が返る。",
      ].join("\n"),
      inputSchema: subscriptionFieldsSchema.shape,
    },
    async (args) => toResult(await addSubscription(db, args)),
  );

  server.registerTool(
    "list_subscriptions",
    {
      title: "サブスク・固定費を一覧する",
      description: [
        "登録済みのサブスク・保険・固定費を返す(契約中が先、名前順)。各要素は id、name、kind、amount(円。外貨のときは目安)、period、currency(JPY 以外は外貨払い)、foreign_amount、exchange_rate、amount_is_estimate、monthly_equivalent(月あたり)、yearly_equivalent(年あたり)、billing_month、billing_day、next_billing_month(年払いの次の支払い月)、previous_amount と amount_changed_on(金額を変えたとき)、price_checked_on(金額を最後に確認した日)、url、note、active。",
        "totals は契約中の合計(monthly=月あたり、yearly=年あたり。年払いは月あたりに直して足す)。",
        "active(true=契約中だけ / false=解約済みだけ)と kind で絞れる。使いどころ: 「サブスクはいくら?」と聞かれたとき、金額が古くなっていないか(price_checked_on が古いもの)を調べるとき、update_subscription / delete_subscription に渡す id を調べるとき。",
      ].join("\n"),
      inputSchema: listSubscriptionsFieldsSchema.shape,
    },
    async (args) => toResult(await listSubscriptions(db, args)),
  );

  server.registerTool(
    "update_subscription",
    {
      title: "サブスク・固定費を更新する",
      description: [
        "登録済みのサブスク・固定費を更新する。id は必須(list_subscriptions で分かる)。変えたい項目だけ渡す。",
        "金額が変わったとき(値上げ・値下げ、プラン変更)は amount を新しい金額にする。直前の金額と、変えた日、金額を確認した日が自動で記録される(画面に「値上がり +¥300」と出る)。公式の料金ページで調べた金額を入れ、確認できなければ利用者に聞く。",
        "調べたけれど金額が変わっていなかったときは、price_checked: true を渡すと、金額を確認した日だけ今日になる。",
        "解約したときは active: false(記録は残り、合計に入らない)。billing_month / billing_day / url / note は null で消せる。年払いから月払いに変えるときは、period と amount を同時に直す。",
      ].join("\n"),
      inputSchema: updateSubscriptionFieldsSchema.shape,
    },
    async (args) => toResult(await updateSubscription(db, args)),
  );

  server.registerTool(
    "delete_subscription",
    {
      title: "サブスク・固定費を削除する",
      description: [
        "登録を1件削除する。id は必須(list_subscriptions で分かる)。登録しまちがえたものを消すときに使う。",
        "解約しただけなら、削除ではなく update_subscription の active: false にする(記録が残る)。実際の支出の記録(取引)は消えない。",
      ].join("\n"),
      inputSchema: deleteSubscriptionSchema.shape,
    },
    async (args) => toResult(await deleteSubscription(db, args)),
  );
}
