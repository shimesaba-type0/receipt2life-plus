import { Nav } from "./components/Nav";
import { Topbar } from "./components/Topbar";
import { Accounts } from "./pages/Accounts";
import { Backup } from "./pages/Backup";
import { Connect } from "./pages/Connect";
import { Calendar } from "./pages/Calendar";
import { Categories } from "./pages/Categories";
import { Day } from "./pages/Day";
import { Home } from "./pages/Home";
import { PhotosAdd } from "./pages/PhotosAdd";
import { Products } from "./pages/Products";
import { Subscriptions } from "./pages/Subscriptions";
import { Search } from "./pages/Search";
import { Tax } from "./pages/Tax";
import { Usage } from "./pages/Usage";
import { Transaction } from "./pages/Transaction";
import { useRoute } from "./router";
import { stagingLabel } from "./stagingBanner";

// ビルド時に VITE_STAGING_LABEL を渡したとき(ステージングのデプロイだけ)に、画面の上に目印の帯を出す。本番のビルドには渡さない
const STAGING = stagingLabel(import.meta.env.VITE_STAGING_LABEL);

export function App() {
  const route = useRoute();
  return (
    <>
      {STAGING && (
        <div class="staging-banner" role="note">
          <strong>STAGING</strong>
          <span>{STAGING}</span>
        </div>
      )}
    <div class="shell">
      <Topbar />
      <Nav route={route} />
      <main class="shell__main">
        {route.name === "home" && <Home />}
        {route.name === "calendar" && <Calendar month={route.month} />}
        {route.name === "day" && <Day date={route.date} />}
        {route.name === "transaction" && <Transaction id={route.id} />}
        {route.name === "photosAdd" && <PhotosAdd target={route.target} />}
        {route.name === "backup" && <Backup />}
        {route.name === "connect" && <Connect />}
        {route.name === "categories" && <Categories />}
        {route.name === "accounts" && <Accounts />}
        {route.name === "subscriptions" && <Subscriptions />}
        {route.name === "tax" && <Tax />}
        {route.name === "usage" && <Usage />}
        {route.name === "products" && <Products month={route.month} product={route.product} by={route.by} />}
        {route.name === "search" && <Search q={route.q} type={route.type} page={route.page} />}
        {route.name === "notfound" && (
          <section class="page">
            <h1 class="page__title">ページが見つかりません</h1>
          </section>
        )}
      </main>
    </div>
    </>
  );
}
