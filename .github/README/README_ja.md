# Iwara ビデオダウンローダーツール

[![GitHub license](https://img.shields.io/github/license/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Star](https://img.shields.io/github/stars/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Star&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Fork](https://img.shields.io/github/forks/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Fork&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)

# Iwara 動画ダウンロードツール

- 一括ダウンロード
- 複数ダウンローダー対応：Aria2（RPC）、iwaradl（RPC）、ブラウザ API、その他（新規タブ）
- Aria2 タスク自動追跡：既存タスクの自動引き継ぎ、失敗/一時停止の自動再開、低速時の自動再起動、重複タスクの自動整理
- 動画の説明文やコメント欄に、作者が提供したサードパーティのクラウドストレージリンクがあるか自動でチェック
- 保存場所およびファイル名をカスタマイズ可能（パス変数 + NFKC 正規化 / 絵文字置換 / 不正文字の除去 / 長さ制限） <sup>\*完全なパスは Aria2・iwaradl モードのみ対応。他のダウンロードモードはファイル名のカスタマイズのみ</sup>
- 動画カードへのチェックボックス注入による一括選択：全選択/反転/解除、ホバー中のスペースキーでクイック選択
- 手動ダウンロード：単数または `|` 区切りの複数動画 ID から一括タスク作成
- 選択した動画の作者を自動フォロー <sup>\*デフォルトでは無効。手動で有効化する必要あり</sup>
- 選択した動画を自動で「いいね」 <sup>\*デフォルトでは無効。手動で有効化する必要あり</sup>
- 非公開および限定公開動画を強制表示 <sup>\*デフォルトでは無効。作者のフォローが必要</sup>
- サブスクリプションページの非公開・限定公開動画をフィルタリング（強制表示とは排他）、タイムラインの既といね動画をフィルタリング <sup>\*デフォルトでは無効</sup>
- プライベート動画のダウンロードをサポート <sup>\*作者とフレンド関係にあるアカウントが必要</sup>
- 非公開動画のダウンロードをサポート <sup>\*動画 ID が必要</sup>
- 動画メタデータの自動ダウンロード（JSON、動画と同名の `.json` ファイル） <sup>\*デフォルトでは無効</sup>
- MediaCenter 連携 <sup>\*実験的機能。「実験的機能」を有効にし、API アドレスとキーを設定する必要あり</sup>
    - Aria2 ダウンロード完了後、メタデータを MediaCenter へ自動プッシュ（失敗時はバックオフ再試行）
    - ローカル動画キャッシュをワンクリックで MediaCenter へ同期（双方向 ID マッピングを自動構築）
    - ローカルデータベースのエクスポート（videos / follows / friends / idmap を分割 JSON で）
- フレンドリクエストをワンクリック承認 <sup>\*デフォルトでは無効。設定で有効化する必要あり</sup>
    - 承認条件を設定可能（OR 評価、いずれか一致で承認） <sup>\*デフォルトは無条件承認</sup>
    - 無条件 / 相手が自分をフォロー中 / 自分が相手をフォロー中 / 相手はプレミアム / 相手は 30 日以内にアクティブ / 相手は登録から 30 日以上 / 相手のアカウントは正常状態
    - コメント証拠：相手はプロフィールにコメントした / 相手は指定フォーラム投稿にコメントした（スレッド ID 設定可）
- インターフェースカスタマイズ：サイド浮動メニュー、テーマカスタマイズ、ワイド画面対応、多言語（日本語 / 简体中文 / English）、設定のインポート/エクスポート

## 使用方法

### スクリプトのインストール

- GreasyFork からインストール  
  **[訪問](https://sleazyfork.org/scripts/422239)**
- GitHub リリース版  
  **[インストール](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/latest/IwaraDownloadTool.user.js)**
- GitHub リリース版 [プレビュー版]  
  **[インストール](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/preview/IwaraDownloadTool.user.js)**

#### サポートされているブラウザ

- Chrome または Chromium ベースのブラウザ（例：Edge） <sup>\*バージョン ≥ 110</sup>
- Firefox <sup>\*バージョン ≥ 110</sup>

#### 推奨スクリプトマネージャー

- Tampermonkey **[公式サイト](https://www.tampermonkey.net/)**

#### 詳細な使用説明

- [Wiki](https://github.com/IwaraEnhance/IwaraDownloadTool/wiki)

#### 利用可能なパス変数

| 変数名         | 説明             | 使用例                             | 出力                |
| -------------- | ---------------- | ---------------------------------- | ------------------- |
| %#NowTime#%    | ダウンロード時間 | %#NowTime:YYYY-MM-DD#%             | 2022-02-22          |
| %#UploadTime#% | 公開時間         | %#UploadTime:YYYY-MM-DD+HH.mm.ss#% | 2022-02-22+22.22.22 |
| %#TITLE#%      | 動画タイトル     | %#TITLE#%                          | 例:タイトル         |
| %#ID#%         | 動画ID           | %#ID#%                             | ExampleID           |
| %#AUTHOR#%     | 動画作者         | %#AUTHOR#%                         | ExampleAuthor       |
| %#ALIAS#%      | 作者ニックネーム | %#ALIAS#%                          | ExampleAlias        |
| %#QUALITY#%    | 画質             | %#QUALITY#%                        | Source              |

完全な例:

`/Iwara/%#AUTHOR#%/%#NowTime:YYYY-MM-DD#%/(%#ALIAS#%)%#UploadTime:YYYY-MM-DD+HH.mmss#%_%#TITLE#%_%#QUALITY#%[%#ID#%].MP4`

出力:

`/Iwara/ExampleAuthor/2022-02-22/(ExampleAlias)2022-02-22+22.22.22_例:タイトル_Source[ExampleID].MP4`

## 依存ライブラリ

### ランタイム依存

- [day.js](https://github.com/iamkun/dayjs) - [MIT License](https://opensource.org/licenses/MIT)
- [idb](https://github.com/jakearchibald/idb) - [ISC License](https://opensource.org/license/isc)
- [emoji-regex](https://github.com/slevithan/emoji-regex-xs) - [MIT License](https://opensource.org/licenses/MIT) <sup>\*内蔵ソース（vendored）、src/core/env.ts 参照</sup>

### 開発依存

- [TypeScript](https://github.com/microsoft/TypeScript) - [Apache-2.0](https://opensource.org/licenses/Apache-2.0)
- [esbuild](https://github.com/evanw/esbuild) - [MIT License](https://opensource.org/licenses/MIT)
- [tsx](https://github.com/privatenumber/tsx) - [MIT License](https://opensource.org/licenses/MIT)

## データとプライバシー

- 動画メタデータのキャッシュ、フォロー/フレンド情報はブラウザのローカル IndexedDB（データベース名 `IwaraDownloadTool`）に保存され、第三者に送信されることはありません
- 設定とページ間同期状態はスクリプトマネージャーの GM ストレージに保存されます。ログイン資格情報は Iwara API リクエスト時にのみ使用されます
- スクリプトは資格情報の維持とメタデータのキャッシュのためにページの fetch を傍受しますが、データの収集・アップロードは一切行いません

## 貢献

あらゆる形での貢献を歓迎します！ローカル開発環境、プロジェクト構成、ビルドシステム、開発規約については[コントリビューションガイド](https://github.com/IwaraEnhance/IwaraDownloadTool/blob/master/CONTRIBUTING.md)をご覧ください。

## 謝辞

貢献してくださったすべての開発者に感謝します。皆さんのおかげで IwaraDownloadTool はより良いものになっています！

[![Contributors](https://contrib.rocks/image?repo=IwaraEnhance/IwaraDownloadTool&max=1000)](https://github.com/IwaraEnhance/IwaraDownloadTool/graphs/contributors)

## 類似プロジェクト

- [iwaradl](https://github.com/Izumiko/iwaradl) - [MIT License](https://opensource.org/licenses/MIT) CLI 版 Iwara 動画ダウンローダー
