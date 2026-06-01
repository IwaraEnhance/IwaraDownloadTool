# Iwara ビデオダウンローダーツール

[![GitHub license](https://img.shields.io/github/license/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Star](https://img.shields.io/github/stars/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Star&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Fork](https://img.shields.io/github/forks/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Fork&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)

# Iwara 動画ダウンロードツール

- 一括ダウンロード
- Aria2 ベースのダウンローダーをサポート
- 動画の説明文やコメント欄に、作者が提供したサードパーティのクラウドストレージリンクがあるか自動でチェック
- 保存場所およびファイル名をカスタマイズ可能 <sup>\*Aria2、IwaraDownloader モードでのみサポート。他のダウンロードモードではファイル名のカスタマイズのみサポート</sup>
- 選択した動画の作者を自動フォロー <sup>\*デフォルトでは無効。手動で有効化する必要あり</sup>
- 選択した動画を自動で「いいね」または「お気に入り」に登録 <sup>\*デフォルトでは無効。手動で有効化する必要あり</sup>
- 非公開およびプライベート動画を強制表示 <sup>\*作者をフォローする必要あり</sup>
- プライベート動画のダウンロードをサポート <sup>\*作者と友達関係にあるアカウントが必要</sup>
- 非公開動画のダウンロードをサポート <sup>\*動画IDを知っている必要あり</sup>

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

- ダウンロード時間 %#NowTime#%
- 公開時間 %#UploadTime#%
- 動画タイトル %#TITLE#%
- 動画ID %#ID#%
- 動画作者 %#AUTHOR#%
- 動画作者（ニックネーム） %#ALIAS#%
- 画質 %#QUALITY#%

  例:  
  `%#NowTime:YYYY-MM-DD#%_%#AUTHOR#%_%#UploadTime:YYYY-MM-DD#%_%#TITLE#%_%#QUALITY#%[%#ID#%].MP4`

  出力例:

  `2024-02-19_ExampleAuthorID_2024-02-18_ExampleTitle_Source[ExampleID].MP4`

## 依存ライブラリ

- [day.js](https://github.com/iamkun/dayjs) - [MIT License](https://opensource.org/licenses/MIT)
- [idb](https://github.com/jakearchibald/idb) - [ISC License](https://opensource.org/license/isc)
- [esbuild](https://github.com/evanw/esbuild) - [MIT License](https://opensource.org/licenses/MIT)
- [emoji-regex](https://github.com/slevithan/emoji-regex-xs) - [MIT License](https://opensource.org/licenses/MIT)
- [aria2rpc](https://github.com/pboymt/aria2rpc)
