import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { parseRoute, type Route } from "./route";

export type { Route };

// keepScroll: 一覧の上に詳細を重ねるときなど、スクロール位置を動かさない
export function navigate(to: string, options: { keepScroll?: boolean } = {}): void {
  history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  if (!options.keepScroll) window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname, location.search));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.pathname, location.search));
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return route;
}

// 画面内のリンク。普通の <a> として働き(右クリック・新しいタブも可)、通常のクリックだけをSPAの移動にする
export function Link(props: { href: string; class?: string; children: ComponentChildren; "aria-label"?: string; "aria-current"?: "page"; keepScroll?: boolean }) {
  const onClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(props.href, { keepScroll: props.keepScroll });
  };
  return (
    <a href={props.href} class={props.class} onClick={onClick} aria-label={props["aria-label"]} aria-current={props["aria-current"]}>
      {props.children}
    </a>
  );
}
