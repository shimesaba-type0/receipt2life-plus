import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addTransactionsSchema, listTransactionsSchema } from "../../core/schema";
import { deleteTransactionSchema, updateTransactionFieldsSchema } from "../../core/transaction-edit-schema";
import { addTransactions, deleteTransaction, listTransactions, updateTransaction } from "../../core/transactions";
import { toResult } from "../result";

// 取引のツール: add_transactions / list_transactions / update_transaction / delete_transaction
// bucket は delete_transaction の delete_photos で写真の実体を消すために使う
export function registerTransactionTools(server: McpServer, db: D1Database, bucket: R2Bucket): void {
  server.registerTool(
    "add_transactions",
    {
      title: "取引を登録する",
      description: [
        "支出(取引)を登録する。transactions は配列で、1枚のレシートにつき1件。",
        "1枚の写真に複数のレシートが写っていたら、別々の取引にして1回の呼び出しでまとめて送る。",
        "必須は amount(円・整数。レシートの支払総額)だけ。読み取れなかった項目は省略してよい(店名かカテゴリが空だと needs_review になり、後で見直せる)。",
        "明細(items): レシート写真を見て、品名・金額の行をそのまま items に入れる(上から順に。各行は name=品名、amount=円・整数)。値引き・割引はマイナスの行にする(例: {\"name\":\"値引\",\"amount\":-50})。明細の合計は amount と一致させる(合わなければ全体がエラーになり、差額が返るので直して再送する)。小計・合計・お預かり・お釣りの行は入れない。外税のレシートは「消費税」の行を1つ足して合計を合わせる。明細は任意で、読み取れないときや1品だけのときは省略してよい。1取引あたり50行まで。",
        "レシートの印字がマスター: 品目の金額・値引き・合計は、レシートに印字されたとおりに登録する。品目の下にインデントや括弧(例: 「(値引 -30)」「▲50」「(クーポン)」)で書かれた値引き・割引は、前の品目の金額を書き換えて差し引かず、別の行(マイナスの金額)として、印字どおりに登録する(値引きの行には、値引き対象の品目と同じ category を付ける)。計算が合うように金額を調整しない。amount はレシートの支払総額(印字の合計)のまま変えない。",
        "合計が合わないとき: 品目の金額は変えずに、読み取りを見直す。それでも合わなければ、差額を「端数・調整」の行(プラスまたはマイナス)として足して合わせるか、利用者に確認する。",
        "行ごとのカテゴリ・税金のフラグ: 行の category / tax_flag は省略すると取引の category / tax_flag に従う。全部同じカテゴリなら、取引の category だけを付けて、行の category は省く。違うカテゴリの行(例: スーパーのレシートの中の洗剤=日用品)や、控除の対象の行(例: ドラッグストアのレシートの中の薬=self_medication)にだけ、行の値を付ける。",
        "例: {\"transactions\":[{\"date\":\"2026-10-11\",\"amount\":1030,\"merchant\":\"Aストア\",\"category\":\"食費\",\"source\":\"receipt\",\"items\":[{\"name\":\"牛乳\",\"amount\":250},{\"name\":\"パン\",\"amount\":330},{\"name\":\"洗剤\",\"amount\":500,\"category\":\"日用品\"},{\"name\":\"値引\",\"amount\":-50}]}]}",
        "category を省略すると、同じ店名(表記ゆれは吸収)の直近の支出にカテゴリがあれば、それを取引のカテゴリに使い、結果の applied_default_category にその名前が入る(違っていれば update_transaction で直す)。category を指定したときは上書きしない。",
        "category と account は既存の名前から選ぶ。選べる名前は list_categories で取れる(初期値 カテゴリ: 食費、日用品、交通・チャージ、娯楽、その他 / 口座: 現金、カード、Suica。カテゴリは追加・変更されている場合がある)。合うカテゴリが本当に無ければ、add_category で作ってから使う。",
        "税金の控除用に分けたい支出には tax_flag を付ける(medical=医療費控除、self_medication=セルフメディケーション税制、donation=寄附金控除。取引に1つ、明細があれば行ごとにも付けられる。不要なら省略)。例: 薬局のレシートは medical か self_medication、ふるさと納税などの寄附は donation。どれにするか・控除の対象になるかは利用者が判断する(金額の記録と集計だけで、控除額の判定はしない)。迷ったら利用者に確認する。",
        "よく使う型の目安: 駐車場→交通・チャージ/現金、Suicaチャージ→交通・チャージ/Suica、自販機→食費/現金。",
        "同日・同額・同じ店の取引は重複として登録せず、既存IDを返す。実際に別の買い物なら allow_duplicate:true を付けて再送する。",
        "全件成功か全件失敗。エラーなら errors に index と項目名と理由が返るので、直して再送する。",
        "写真の添付は、このツールではできない(create_photo_upload_link でリンクを作り、利用者が Web UI の /photos/add で追加する)。",
      ].join("\n"),
      inputSchema: addTransactionsSchema.shape,
    },
    async (args) => toResult(await addTransactions(db, args)),
  );

  server.registerTool(
    "list_transactions",
    {
      title: "取引を一覧する",
      description: [
        "登録済みの取引を、日付の新しい順で返す。",
        "from / to(YYYY-MM-DD、両端を含む)と category(カテゴリ名)で絞り込める。limit は既定100、最大500。",
        "tax_flag で税金の控除用フラグを絞り込める(medical / self_medication / donation、または \"any\" で何かのフラグが付いたもの全部)。確定申告の準備で、年の範囲(from / to)と組み合わせて明細を見るときに使う。各取引の tax_flag も返る(なしは null)。",
        "明細(items)のある取引は、行の実効カテゴリ・実効フラグ(行の値、無ければ取引の値)のどれかが category / tax_flag に当てはまれば含まれる。金額の内訳を見るときは、各行の amount と category / tax_flag を見る(行の category / tax_flag が null の行は取引の値に従う)。",
        "各取引には items(明細の配列。id、position、name、amount、category、tax_flag、memo。明細なしは空配列)が付く。include_items: false で省ける。",
        "登録前に重複を確かめたいときや、直近の記録を見返したいときに使う。",
      ].join("\n"),
      inputSchema: listTransactionsSchema.shape,
    },
    async (args) => toResult(await listTransactions(db, args)),
  );

  server.registerTool(
    "update_transaction",
    {
      title: "取引を修正する",
      description: [
        "登録済みの取引を修正する。誤って登録した金額・店名・カテゴリなどを直すときに使う。",
        "id は必須。list_transactions で対象の id を確認してから呼ぶ。",
        "直したい項目だけを渡す。渡さなかった項目は変わらない。",
        "項目: date(YYYY-MM-DD・未来日不可)、amount(円・整数、1〜10,000,000)、merchant(店名)、category(カテゴリ名)、account(口座名)、memo、source(receipt / manual / voice)、tax_flag(medical=医療費控除 / self_medication=セルフメディケーション税制 / donation=寄附金控除)、items(明細)。",
        "items は明細を丸ごと置き換える(一部の行だけの変更でも、全部の行を送る)。省略または null で明細は変えない。[] で明細を全部消す。各行は name・amount(値引きはマイナス)・category・tax_flag・memo(add_transactions と同じ)。明細がある取引は、明細の合計 = amount でなければエラーになり、差額が返る。amount だけを直すときも今の明細の合計と合わせる必要がある(合わなければ items もいっしょに送る)。",
        "merchant / category / account / memo / tax_flag は null を渡すと空にできる(tax_flag: null でフラグを外す)。date / amount / source は空にできない。",
        "category と account は既存の名前から選ぶ。未知の名前はエラーになり、選べる値が返る。",
        "修正後、店名があり、すべての行に実効カテゴリ(行のカテゴリ、無ければ取引のカテゴリ)があれば status は ok、そうでなければ needs_review に自動で変わる。",
        "修正後に、同じ日・金額・店の別の取引があると、更新は行ったうえで warnings に重複の疑いのある取引 id が返る。重複なら、不要な側を delete_transaction で削除する。",
        "存在しない id や不正な値はエラーになり、errors に項目名と理由が返るので、直して再送する。",
      ].join("\n"),
      inputSchema: updateTransactionFieldsSchema.shape,
    },
    async (args) => toResult(await updateTransaction(db, args)),
  );

  server.registerTool(
    "delete_transaction",
    {
      title: "取引を削除する",
      description: [
        "登録済みの取引を1件削除する。重複して登録したものや、誤って登録したものを消すときに使う。",
        "削除は取り消せない。必ず先に list_transactions で id と内容を確認し、消してよい取引だけを指定する。内容の修正だけなら update_transaction を使う。",
        "明細(items)とリンクは、取引といっしょに消える。",
        "写真が紐づいている取引は、既定では削除せずエラーにする(エラー文に枚数が出る)。写真もいっしょに消してよいと利用者が確認したときだけ、delete_photos: true を付けて呼び直す(写真の実体も消え、取り消せない)。",
        "存在しない id もエラーになる。成功すると、削除した取引の内容(deleted.transaction)と、いっしょに消した明細・写真・リンクの件数(deleted.items / photos / links)を返す。",
      ].join("\n"),
      inputSchema: deleteTransactionSchema.shape,
    },
    async (args) => toResult(await deleteTransaction(db, args, { bucket })),
  );
}
