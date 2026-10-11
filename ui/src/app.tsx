import { Nav } from "./components/Nav";
import { Calendar } from "./pages/Calendar";
import { Day } from "./pages/Day";
import { Home } from "./pages/Home";
import { useRoute } from "./router";

export function App() {
  const route = useRoute();
  return (
    <div class="shell">
      <Nav route={route} />
      <main class="shell__main">
        {route.name === "home" && <Home />}
        {route.name === "calendar" && <Calendar month={route.month} />}
        {route.name === "day" && <Day date={route.date} />}
        {route.name === "notfound" && (
          <section class="page">
            <h1 class="page__title">ページが見つかりません</h1>
          </section>
        )}
      </main>
    </div>
  );
}
