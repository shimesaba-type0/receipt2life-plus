import { AccountsSection } from "./AccountsSection";
import "./Categories.css";

// 支払方法の管理ページ。「どう払ったか」の平らな一覧(カテゴリは「何に使ったか」の階層なので、別のページにしている)
export function Accounts() {
  return (
    <section class="page cat">
      <header class="cat__header">
        <h1 class="cat__title">支払方法</h1>
        <p class="cat__lead">現金・カードなど、支出の支払方法です。AI(Claude など)からも同じように増やせます。</p>
      </header>
      <AccountsSection />
    </section>
  );
}
