import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listMerchants, merchantsQuerySchema } from "../../core/merchants";
import { toResult } from "../result";

// 店の情報を引くツール: list_merchants(読み取り専用。過去の取引から、店名ごとにまとめる)
export function registerMerchantTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "list_merchants",
    {
      title: "登録済みの店の情報を引く",
      description: [
        "過去に登録した取引から、店ごとの情報を引く(読み取り専用)。店の情報を別に登録する仕組みは無く、取引を登録するたびに、その店の記録として溜まっていく。",
        "使いどころ: (1) レシートの店名が読みにくい・表記ゆれがあるとき、過去の同じ店の表記・電話・住所・登録番号を確かめる。 (2) 支払方法が写っていないとき、その店でよく使う支払方法(accounts)を候補にする。タクシーのように支払いがいくつもある店でも、使った分が件数つきで並ぶ。 (3) レジ番号・店番号の印字が薄くて読めないとき、過去に印字されていた値(register_nos / store_codes)を候補にして、見えている桁と照らし合わせる。",
        "戻りは店ごと: merchant(最新の表記)、count(取引の件数)、last_date、category / account(いちばん多いもの)、phone、address、invoice_number、accounts / categories / register_nos / store_codes(各 { value, count, last_date }。件数の多い順、最大5個)。",
        "q は店名・電話番号(数字だけでも可)・住所・カテゴリ名の部分一致(全角半角・かなカナ・大文字小文字は区別しない)。category でその店のいちばん多いカテゴリを絞る。省略するとよく使う順。limit は既定8、最大20。",
        "候補は推測の材料にすぎない。レシートに読めた値と食い違うときは、レシートの値を優先し、読めないものを過去の値で埋めて登録しない(確信がなければ省略する)。",
      ].join("\n"),
      inputSchema: merchantsQuerySchema.shape,
    },
    async (args) => toResult(await listMerchants(db, args)),
  );
}
