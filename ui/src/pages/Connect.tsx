import { useState } from "preact/hooks";
import { BrandMark } from "../components/BrandMark";
import { CONNECT_DOC_URL, GITHUB_URL } from "../links";
import { connectorFields, mcpUrl, TRY_PROMPTS } from "./connectLogic";
import "./Connect.css";

// AI(Claude など)とつなぐ手順。MCP サーバーのURLは、いま開いているアドレスから作る(ソースに自分のドメインを書かない)
export function Connect() {
  const url = mcpUrl(location.origin);
  const [copied, setCopied] = useState<"done" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section class="page connect">
      <header class="connect__header">
        <h1 class="connect__title brandmark-line"><BrandMark size={24} />AIとつなぐ(MCPサーバーの登録)</h1>
        <p class="connect__lead">Claude などのAIに「支出を登録して」「今月いくら使った?」と頼めるようにします。AIから記録した内容は、この画面にそのまま出ます。</p>
      </header>

      <section class="connect__card" aria-labelledby="connect-url-h">
        <h2 id="connect-url-h" class="connect__h2">このアプリのMCPサーバーのURL</h2>
        <div class="connect__url">
          <code class="connect__code" data-testid="mcp-url">{url}</code>
          <button type="button" class="connect__copy" onClick={copy}>
            コピー
          </button>
        </div>
        <p class="connect__note" role="status">
          {copied === "done" && "コピーしました。"}
          {copied === "failed" && "コピーできませんでした。上のURLを長押しして選んでください。"}
        </p>
      </section>

      <section class="connect__card" aria-labelledby="connect-claude-h">
        <h2 id="connect-claude-h" class="connect__h2">Claude.ai に追加する</h2>
        <p class="connect__note">カスタムコネクタの追加は有料プランの機能です。追加はWeb(claude.ai)かデスクトップで行います。一度設定すれば、スマホのClaudeアプリからも使えます。</p>
        <ol class="connect__steps">
          <li>claude.ai を開き、プロフィール → 設定 → コネクタ → <b>カスタムコネクタを追加</b> を選ぶ。</li>
          <li>
            次のとおり入力する。
            <dl class="connect__fields">
              {connectorFields(location.origin).map((f) => (
                <div key={f.label} class="connect__field">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </li>
          <li>追加して「接続」を押す。ログイン画面(Cloudflare Access)が開くので、ログインして許可する。</li>
          <li>チャットの入力欄の「＋」(ツール)メニューで、追加したコネクタをオンにする。</li>
        </ol>
      </section>

      <section class="connect__card" aria-labelledby="connect-try-h">
        <h2 id="connect-try-h" class="connect__h2">動作確認</h2>
        <p class="connect__note">チャットで、次のように頼んでみます。</p>
        <ul class="connect__list">
          {TRY_PROMPTS.map((p) => (
            <li key={p}>「{p}」</li>
          ))}
        </ul>
        <p class="connect__note">登録したあと、ホームやカレンダーを開くと反映されています。</p>
      </section>

      <section class="connect__card" aria-labelledby="connect-trouble-h">
        <h2 id="connect-trouble-h" class="connect__h2">つながらないとき</h2>
        <ul class="connect__list">
          <li>ログインの画面でエラーになる → Cloudflare Access の「許可するリダイレクトURI」にClaudeのコールバックURLが入っているか確認する(エラーに実際のURLが出る)。</li>
          <li>ツールが出てこない → チャットの「＋」メニューで、コネクタがオンになっているか確認する。</li>
          <li>ChatGPTなど、Claude以外のAIは、つながるかどうかまだ確かめていません。</li>
        </ul>
        <p class="connect__note">設定の詳しい手順と、使えるツールの一覧は、リポジトリの文書にあります。</p>
      </section>

      <p class="connect__links">
        <a href={CONNECT_DOC_URL} target="_blank" rel="noopener noreferrer">詳しい手順(GitHub)</a>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub のページ</a>
      </p>
    </section>
  );
}
