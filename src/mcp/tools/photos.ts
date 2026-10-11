import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createPhotoUploadLink,
  getPhotos,
  getPhotosFieldsSchema,
  listPhotos,
  listPhotosFieldsSchema,
  photoLinkFieldsSchema,
} from "../../core/photos";
import { toResult } from "../result";

// 写真のツール: create_photo_upload_link / list_photos / get_photos
// origin は /mcp へのリクエストのURLから取ったもの(ドメインをコードに書かない)
export function registerPhotoTools(server: McpServer, db: D1Database, bucket: R2Bucket, origin: string): void {
  server.registerTool(
    "create_photo_upload_link",
    {
      title: "写真のアップロード用リンクを作る",
      description: [
        "利用者が写真(レシート、半券、チケット、イベントの写真など)を登録するための、アップロード画面のリンクを作る。写真の実体はこのチャットからは送れないので、写真を残したいときは必ずこのツールを使う。",
        "流れ: このツールでリンクを作る → リンクをユーザーに見せて「このリンクを開いて写真を選んでください」と伝える → ユーザーがブラウザで開いて写真を選んで追加する。チャットに貼られた画像そのものを、このツールで登録することはできない。",
        "date(YYYY-MM-DD)、transaction_id(取引のid)、event_id(出来事のid)のうち1つ以上が必須。写真をどの日・どの取引・どの出来事に紐づけるかを指定する。",
        "例: 支出を add_transactions で登録した後に、そのレシート写真も残したいなら、返ってきた取引の id を transaction_id に渡す。旅行の写真なら、list_events で調べた event_id を渡す。日付だけの指定もできる。",
        "caption(200文字まで)は写真の説明で、任意。",
        "transaction_id / event_id が存在しなければエラーになる(errors に項目名と理由が返るので、直して再送する)。",
        "リンクに有効期限はなく、利用者本人のログイン(Cloudflare Access)の内側でだけ開ける。戻りの url をそのままユーザーに渡す。",
      ].join("\n"),
      inputSchema: photoLinkFieldsSchema.shape,
    },
    async (args) => toResult(await createPhotoUploadLink(db, origin, args)),
  );

  server.registerTool(
    "list_photos",
    {
      title: "写真を一覧する",
      description: [
        "登録済みの写真のメタ情報(画像そのものではない)を返す。各要素は id、date、transaction_id、event_id、caption、content_type、size(バイト)、created_at。",
        "date、transaction_id、event_id のうち1つ以上が必須。複数を指定したら、どれかに当てはまる写真をまとめて返す(重複なし)。",
        "date を指定すると、その日の詳細画面と同じ範囲になる。つまり、その日の日付に紐づく写真に加えて、その日の取引に紐づく写真と、その日を含む期間の出来事に紐づく写真も含まれる。",
        "transaction_id / event_id は、その取引・出来事に紐づく写真だけ。存在しない id はエラーになる。",
        "使いどころ: 「この日の写真を見せて」と頼まれたとき、またはレシート写真の有無を確かめたいときに、まずこのツールで id を調べる。画像の中身を見るには、その id を get_photos に渡す。",
      ].join("\n"),
      inputSchema: listPhotosFieldsSchema.shape,
    },
    async (args) => toResult(await listPhotos(db, bucket, args)),
  );

  server.registerTool(
    "get_photos",
    {
      title: "写真の画像を取得する",
      description: [
        "写真の画像そのもの(JPEG / PNG / WebP)を、メタ情報のテキストと一緒に返す。ids は list_photos で調べた写真の id で、1回に1〜4個まで。",
        "使いどころ: レシート写真を見て金額・店名・日付を読み取り、add_transactions で登録する流れ。すでに登録した取引の写真を見直して、update_transaction で金額や店名を直すときにも使う。思い出の写真を見ながら、その日の出来事を話すときにも使う。",
        "存在しない id が含まれていると、取れた写真は返したうえで、その id を errors に書いてエラーにする。",
        "1回に返す画像の合計は約6MBまで。超える分は返さず、skipped に理由が入る。その場合は、返せなかった id だけで呼び直す。",
        "新しい写真の登録はこのツールではできない。登録は create_photo_upload_link で出したリンクをユーザーに開いてもらう。",
      ].join("\n"),
      inputSchema: getPhotosFieldsSchema.shape,
    },
    async (args): Promise<CallToolResult> => {
      const result = await getPhotos(db, bucket, args);
      if (!("images" in result)) return toResult(result);
      const { images, ...summary } = result;
      return {
        content: [
          { type: "text", text: JSON.stringify(summary) },
          ...images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
        ],
        // 存在しない id があれば、取れた画像を返したうえでエラーにする。1枚も返せないときもエラー
        ...(summary.ok && images.length > 0 ? {} : { isError: true }),
      };
    },
  );
}
