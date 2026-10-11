import type { Identity } from "./auth/identity";

export interface Env {
  DB: D1Database;
  // 写真の保存先(R2)。公開しない。配信は認証を通したWorker経由
  PHOTOS: R2Bucket;
  // Web UI の静的ファイル(ui/dist)
  ASSETS: Fetcher;
  // Cloudflare Access のJWT検証用。どちらかが空なら全リクエストを拒否する(フェイルクローズ)
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  // ローカル開発専用。"1" かつホストがlocalhostのときだけ認証を素通りにする。本番には置かない
  AUTH_BYPASS?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { identity: Identity };
};
