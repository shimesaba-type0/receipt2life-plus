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
        "消費税の税率と税額(任意。印字がある場合だけ): 明細の各行に tax_rate(税率%)と tax_label(印字の記号)、取引に tax_lines(税率別の内訳)を入れられる。",
        "税率はレシートに印字された数字をそのまま入れる(8、10、1 など。計算しない)。税率の表はないので、将来の税率(例: 食料品だけ1%)もそのまま入る。",
        "軽減税率の記号(※・＊・軽・(軽)・★・軽減 など)の書き方は店ごとに違う。レシートの凡例(「※は軽減税率対象」「★印は軽減税率(8%)適用商品」など)を読んで数字にする。印字の記号は tax_label に入れてよい(例: {\"name\":\"牛乳\",\"amount\":250,\"tax_rate\":8,\"tax_label\":\"※\"})。",
        "レシート下部の税率別の内訳(10%対象 ¥1,100 消費税 ¥100、8%対象 ¥540 内消費税 ¥40 など)は tax_lines に入れる(税率ごとに1行: rate、taxable_amount=対象金額、tax_amount=消費税額、label=印字の記号)。対象金額が税込か税抜かが分かるときは amount_basis に入れる(included=税込・内税、excluded=税抜・外税)。印字が無い数字は省略し、こちらで計算して補わない。例: \"tax_lines\":[{\"rate\":10,\"taxable_amount\":1100,\"tax_amount\":100,\"amount_basis\":\"included\"},{\"rate\":8,\"taxable_amount\":540,\"tax_amount\":40,\"amount_basis\":\"included\",\"label\":\"※\"}]",
        "内税・外税の別が不明、記号の意味が不明(凡例が無い・初めて見る書き方)、印字が薄い場合は、推測せずユーザーに聞く(分からない項目は省略して登録してもよい)。tax_lines の合計が amount と合わなくてもエラーにはせず、tax_warnings で知らせるので、読み取りを見直すか利用者に確認する。",
        "tax_rate / tax_lines は消費税の記録で、tax_flag(医療費控除・セルフメディケーション税制・寄附金控除の控除用フラグ)とは別物。混同しない。",
        "よく使う型の目安: 駐車場→交通・チャージ/現金、Suicaチャージ→交通・チャージ/Suica、自販機→食費/現金。",
        "レシートに印字された情報(印字がある項目だけ。任意): paid_time(決済時刻。日本時間の HH:MM。レシートの日付 date と時刻)、merchant_phone(店の電話番号)、merchant_address(店の住所)、invoice_number(適格請求書発行事業者の登録番号。T + 数字13桁。「登録番号」「事業者番号」の印字)、clerk_name(対応した店員の名前。「担当」「責任者」「レジ」の印字)、receipt_no(レシート番号・伝票番号)。後から店に問い合わせることがあるので、電話番号・住所・時刻は特に拾う(タクシーの領収書など)。list_transactions の keyword で、電話番号や担当者名などから後で探せる。",
        "印字が無い項目は省略する(推測で埋めない)。invoice_number は全角・小文字の t・ハイフンや空白入りでも受け付けて正規化するが、T と数字13桁にならなければエラーになる(読み取りを見直す)。",
        "読み取れない・薄くて判読できない項目は、推測で埋めない。判読できないときは、登録する前に利用者に選択肢を示して確認する: (1) 利用者に値を教えてもらって補う、(2) 合計金額だけ登録する(明細は省略)、(3) 登録をやめる。利用者が決めるまで登録しない。部分的に読めない項目(例: 電話番号だけ薄い)は、その項目だけ省略して登録し、結果を利用者に伝えて、必要なら後で update_transaction で補うよう案内する。",
        "同日・同額・同じ店の取引は重複として登録せず、既存IDを返す。実際に別の買い物なら allow_duplicate:true を付けて再送する。paid_time がある取引は、時刻も含めて判定する(同じ日に同じ店で同額でも、時刻が違えば別の買い物として登録する)。",
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
        "keyword で、店名・電話番号・住所・担当者名(clerk_name)・メモ・レシート番号・登録番号のどれかに部分一致する取引を探せる(後から店に問い合わせるとき、電話番号や担当者名から探す用途。電話番号は数字だけでも当たる)。ほかの条件と組み合わせられる。",
        "各取引には、レシートに印字された情報(paid_time=決済時刻 HH:MM、merchant_phone、merchant_address、invoice_number=登録番号、clerk_name、receipt_no。無い項目は null)も返る。",
        "tax_flag で税金の控除用フラグを絞り込める(medical / self_medication / donation、または \"any\" で何かのフラグが付いたもの全部)。確定申告の準備で、年の範囲(from / to)と組み合わせて明細を見るときに使う。各取引の tax_flag も返る(なしは null)。",
        "明細(items)のある取引は、行の実効カテゴリ・実効フラグ(行の値、無ければ取引の値)のどれかが category / tax_flag に当てはまれば含まれる。金額の内訳を見るときは、各行の amount と category / tax_flag を見る(行の category / tax_flag が null の行は取引の値に従う)。",
        "各取引には items(明細の配列。id、position、name、amount、category、tax_flag、memo、tax_rate=税率%(不明は null)、tax_label=印字の記号。明細なしは空配列)と tax_lines(税の内訳。rate、taxable_amount、tax_amount、amount_basis、label。税率の高い順。なしは空配列)が付く。include_items: false で両方を省ける。税率別の税額の合計は summarize_tax で出す。",
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
        "項目: date(YYYY-MM-DD・未来日不可)、amount(円・整数、1〜10,000,000)、merchant(店名)、category(カテゴリ名)、account(口座名)、memo、source(receipt / manual / voice)、tax_flag(medical=医療費控除 / self_medication=セルフメディケーション税制 / donation=寄附金控除)、items(明細)、paid_time(決済時刻 HH:MM)、merchant_phone(店の電話番号)、merchant_address(店の住所)、invoice_number(登録番号。T + 数字13桁。全角・小文字・ハイフンや空白入りは正規化する)、clerk_name(対応した店員)、receipt_no(レシート番号)。レシートから読み取れなかった項目を後から補うときにも使う。",
        "tax_lines(税の内訳)も丸ごと置き換える。省略または null で変えない。[] で全部消す。各行は rate(税率%。印字どおり)・taxable_amount・tax_amount・amount_basis(included=税込 / excluded=税抜。分かるときだけ)・label。明細の各行の tax_rate(税率%)・tax_label(印字の記号)は items といっしょに送る。税率はレシートに印字された数字をそのまま入れ(計算しない)、内税・外税の別や記号の意味が分からないときは推測せずユーザーに聞く。tax_flag(医療費控除など)とは別物。",
        "items は明細を丸ごと置き換える(一部の行だけの変更でも、全部の行を送る)。省略または null で明細は変えない。[] で明細を全部消す。各行は name・amount(値引きはマイナス)・category・tax_flag・memo・tax_rate・tax_label(add_transactions と同じ)。明細がある取引は、明細の合計 = amount でなければエラーになり、差額が返る。amount だけを直すときも今の明細の合計と合わせる必要がある(合わなければ items もいっしょに送る)。",
        "merchant / category / account / memo / tax_flag / paid_time / merchant_phone / merchant_address / invoice_number / clerk_name / receipt_no は null を渡すと空にできる(tax_flag: null でフラグを外す)。date / amount / source は空にできない。",
        "category と account は既存の名前から選ぶ。未知の名前はエラーになり、選べる値が返る。",
        "修正後、店名があり、すべての行に実効カテゴリ(行のカテゴリ、無ければ取引のカテゴリ)があれば status は ok、そうでなければ needs_review に自動で変わる。",
        "修正後に、同じ日・金額・店(paid_time があれば時刻も同じ)の別の取引があると、更新は行ったうえで warnings に重複の疑いのある取引 id が返る。重複なら、不要な側を delete_transaction で削除する。",
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
        "明細(items)・税の内訳(tax_lines)・リンクは、取引といっしょに消える。",
        "写真が紐づいている取引は、既定では削除せずエラーにする(エラー文に枚数が出る)。写真もいっしょに消してよいと利用者が確認したときだけ、delete_photos: true を付けて呼び直す(写真の実体も消え、取り消せない)。",
        "存在しない id もエラーになる。成功すると、削除した取引の内容(deleted.transaction)と、いっしょに消した明細・写真・リンクの件数(deleted.items / photos / links)を返す。",
      ].join("\n"),
      inputSchema: deleteTransactionSchema.shape,
    },
    async (args) => toResult(await deleteTransaction(db, args, { bucket })),
  );
}
