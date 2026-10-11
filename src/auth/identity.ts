// 認証の結果(誰か)。getIdentity() で取り出す。認証方式を差し替えても、利用側は変えない
export interface Identity {
  id: string;
  email?: string;
}
