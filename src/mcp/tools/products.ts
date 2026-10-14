import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listProducts, listProductsSchema, productHistory, productHistorySchema } from "../../core/products";
import { toResult } from "../result";

// 商品ごとの集計のツール: summarize_products
const inputSchema = listProductsSchema.extend({ product: productHistorySchema.shape.product.optional().describe("商品名かJANコード。指定すると、その商品の月ごとの購入数・単価の推移と買い物の一覧を返す(省略すると、商品の一覧)") });

export function registerProductTools(server: McpServer, db: D1Database): void {
  server.registerTool(
    "summarize_products",
    {
      title: "商品ごとの購入数・単価を調べる",
      description: [
        "明細(レシートの行)の商品ごとに、買った数・金額・単価を集計する。読み取り専用。商品のキーは、明細の product(統一した商品名)で、無ければ品名(name)。値引きの行は数えない。明細のある取引だけが対象。",
        "使いどころ: 「今月、牛乳を何本買った?」「卵の値段は上がった?」「いちばん安く買えたのはいつ・どの店?」。",
        "product を省略すると、商品の一覧(商品名ごとの lines=買った行数、quantity=買った数、amount=金額、last_date、has_unit_price。金額の大きい順)。from / to(YYYY-MM-DD)で期間、q で商品名の絞り込み(部分一致。全角半角・かなカナは区別しない)、limit で件数(既定50)。",
        "product を指定すると、その商品の履歴: months(月ごとの lines・quantity・amount・unit_price)、unit_price(latest=最新、cheapest=最安(日付と店)、average=平均)、purchases(新しい順。日付・店・買った数・金額・単価)。月の購入数は months[].quantity。",
        "単価(unit_price)は { per_unit, unit }(1g・1ml・1個あたりの円)。100mlあたりなどは per_unit に掛けて伝える(例: 牛乳 0.198円/ml は 19.8円/100ml、1Lなら 198円)。単価は、明細に内容量(content_amount と content_unit)が入っている行だけ出る。入っていない過去の行は、add の明細を update_transaction で直すと出る。",
        "商品名は、一覧(product を省略した結果)の名前を使う。JANコード(8桁か13桁の数字)でも指定できる。同じJANの明細は、品名の表記が違っても1つの商品にまとめて集計される。新しくレシートを登録するときは、明細に product(統一した商品名。例: 「牛乳」)・quantity(買った数)・content_amount と content_unit(1つあたりの内容量)を付けると、ここで集計できる。",
      ].join("\n"),
      inputSchema: inputSchema.shape,
    },
    async (args) => {
      const { product, ...rest } = z.object(inputSchema.shape).parse(args);
      if (product !== undefined) return toResult(await productHistory(db, { product, from: rest.from, to: rest.to }));
      return toResult(await listProducts(db, rest));
    },
  );
}
