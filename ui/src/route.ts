// ルーティングの純粋な部分(DOMに触れない。テストする)
export type Route =
  | { name: "home" }
  | { name: "calendar"; month: string | null }
  | { name: "day"; date: string }
  | { name: "notfound" };

const MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// パスとクエリから、表示するページを決める(純粋な関数。テストする)
export function parseRoute(pathname: string, search = ""): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  if (path === "/calendar") {
    const month = new URLSearchParams(search).get("month");
    return { name: "calendar", month: month && MONTH.test(month) ? month : null };
  }
  const day = /^\/day\/(\d{4}-\d{2}-\d{2})$/.exec(path);
  if (day?.[1] && DATE.test(day[1])) return { name: "day", date: day[1] };
  return { name: "notfound" };
}
