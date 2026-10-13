import { createApp } from "./app";
import { fetchLinkTitle } from "./core/link-titles";

// 本番だけ、リンクのタイトルを oEmbed で取りに行く(テストの createApp() は取りに行かない)
export default createApp({ fetchTitle: fetchLinkTitle });
