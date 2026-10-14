import { createApp } from "./app";
import { fetchLinkTitle } from "./core/link-titles";

// 本番だけ、リンクのタイトルを oEmbed で取りに行く(テストの createApp() は取りに行かない)
// 使用量のグラフ用に、Cloudflare の分析 API へ取りに行く fetch も、本番だけ渡す
export default createApp({ fetchTitle: fetchLinkTitle, usageFetch: fetch });
