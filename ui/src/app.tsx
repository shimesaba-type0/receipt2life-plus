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
import { Tax } from "./pages/Tax";
import { Transaction } from "./pages/Transaction";
import { useRoute } from "./router";

export function App() {
  const route = useRoute();
  return (
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
        {route.name === "tax" && <Tax />}
        {route.name === "notfound" && (
          <section class="page">
            <h1 class="page__title">ページが見つかりません</h1>
          </section>
        )}
      </main>
    </div>
  );
}
