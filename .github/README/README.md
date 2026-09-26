# Iwara Download Tool

[![GitHub license](https://img.shields.io/github/license/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Star](https://img.shields.io/github/stars/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Star&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Fork](https://img.shields.io/github/forks/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Fork&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)

- Batch downloading
- Multiple downloaders: Aria2 (RPC), iwaradl (RPC), browser API, Others (new tab)
- Aria2 task auto-tracking: automatically takes over existing tasks, auto-resumes failed/paused ones, restarts slow ones, deduplicates repeated tasks
- Automatically checks if third-party cloud storage links are provided by the author in the video description or comments
- Customizable save location and file names (path variables + NFKC normalization / Emoji replacement / illegal character sanitization / length truncation) <sup>\*Full path supported only in Aria2 and iwaradl modes; other download modes support file name customization only</sup>
- Batch selection: injected checkboxes on video cards, with select-all / invert / deselect and spacebar quick-select on hover
- Manual download: batch-create tasks from one or multiple video IDs separated by `|`
- Automatically follow the authors of selected videos <sup>\*Disabled by default, needs to be enabled manually</sup>
- Automatically like/favorite selected videos <sup>\*Disabled by default, needs to be enabled manually</sup>
- Forced display of unlisted and private videos <sup>\*Disabled by default, requires following the author</sup>
- Filter unlisted and private videos on the subscriptions page (mutually exclusive with forced display), filter liked videos on the timeline <sup>\*Disabled by default</sup>
- Supports downloading private videos <sup>\*Requires an account that is friends with the author</sup>
- Supports downloading hidden videos <sup>\*Requires knowing the video ID</sup>
- Automatic video metadata download (JSON, a `.json` file named after the video) <sup>\*Disabled by default</sup>
- MediaCenter integration <sup>\*Experimental; requires enabling "Experimental Features" and configuring the API address and key</sup>
    - Automatically push metadata to MediaCenter after Aria2 downloads complete, with automatic backoff retry on failure
    - One-click sync of the local video cache to MediaCenter (automatic two-way ID mapping)
    - Local database export (videos / follows / friends / idmap tables as JSON)
- One-click friend request approval <sup>\*Disabled by default, needs to be enabled in settings</sup>
    - Configurable approval conditions (OR semantics, approve if any matches) <sup>\*Defaults to unconditional approval</sup>
    - Always approve / they follow me / I follow them / they are Premium / active within 30 days / account older than 30 days / account in good standing
    - Comment evidence: commented on my profile / commented on a specified forum thread (thread ID configurable)
- Interface customization: side floating menu, theme customizations, widescreen support, multiple languages (English / 简体中文 / 日本語), configuration import/export

## Instructions

### Install the Script

- Install from GreasyFork  
  **[Visit](https://sleazyfork.org/scripts/422239)**
- GitHub Release  
  **[Install](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/latest/IwaraDownloadTool.user.js)**
- GitHub Release [Preview Version]  
  **[Install](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/preview/IwaraDownloadTool.user.js)**

#### Supported Browsers

- Chrome or Chromium-based browsers (e.g., Edge) <sup>\*Version ≥ 110</sup>
- Firefox <sup>\*Version ≥ 110</sup>

#### Recommended Script Managers

- Tampermonkey **[Official Website](https://www.tampermonkey.net/)**

#### Detailed Usage Instructions

- [Wiki](https://github.com/IwaraEnhance/IwaraDownloadTool/wiki)

#### Available Path Variables

| Variable       | Description     | Example                            | Output              |
| -------------- | --------------- | ---------------------------------- | ------------------- |
| %#NowTime#%    | Download time   | %#NowTime:YYYY-MM-DD#%             | 2022-02-22          |
| %#UploadTime#% | Upload time     | %#UploadTime:YYYY-MM-DD+HH.mm.ss#% | 2022-02-22+22.22.22 |
| %#TITLE#%      | Video title     | %#TITLE#%                          | Example Title       |
| %#ID#%         | Video ID        | %#ID#%                             | ExampleID           |
| %#AUTHOR#%     | Video author    | %#AUTHOR#%                         | ExampleAuthor       |
| %#ALIAS#%      | Author nickname | %#ALIAS#%                          | ExampleAlias        |
| %#QUALITY#%    | Quality         | %#QUALITY#%                        | Source              |

Full example:

`/Iwara/%#AUTHOR#%/%#NowTime:YYYY-MM-DD#%/(%#ALIAS#%)%#UploadTime:YYYY-MM-DD+HH.mmss#%_%#TITLE#%_%#QUALITY#%[%#ID#%].MP4`

Output:

`/Iwara/ExampleAuthor/2022-02-22/(ExampleAlias)2022-02-22+22.22.22_Example Title_Source[ExampleID].MP4`

## Dependencies

### Runtime Dependencies

- [day.js](https://github.com/iamkun/dayjs) - [MIT License](https://opensource.org/licenses/MIT)
- [idb](https://github.com/jakearchibald/idb) - [ISC License](https://opensource.org/license/isc)
- [emoji-regex](https://github.com/slevithan/emoji-regex-xs) - [MIT License](https://opensource.org/licenses/MIT) <sup>\*Vendored source, see src/core/env.ts</sup>

### Dev Dependencies

- [TypeScript](https://github.com/microsoft/TypeScript) - [Apache-2.0](https://opensource.org/licenses/Apache-2.0)
- [esbuild](https://github.com/evanw/esbuild) - [MIT License](https://opensource.org/licenses/MIT)
- [tsx](https://github.com/privatenumber/tsx) - [MIT License](https://opensource.org/licenses/MIT)

## Data & Privacy

- Video metadata cache, follow/friend info are stored in the browser's local IndexedDB (database name `IwaraDownloadTool`); nothing is sent to any third party
- Configuration and cross-page sync state are stored in the script manager's GM storage; login credentials are only used when requesting the Iwara API
- The script intercepts page fetch for credential maintenance and metadata caching; it collects and uploads nothing

## Contributing

Contributions of all kinds are welcome! See the [Contribution Guide](https://github.com/IwaraEnhance/IwaraDownloadTool/blob/master/CONTRIBUTING.md) for how to get started, including local dev setup, project structure, build system, and development conventions.

## Acknowledgments

Thanks to all the contributors — IwaraDownloadTool is what it is because of you!

[![Contributors](https://contrib.rocks/image?repo=IwaraEnhance/IwaraDownloadTool&max=1000)](https://github.com/IwaraEnhance/IwaraDownloadTool/graphs/contributors)

## Similar Projects

- [iwaradl](https://github.com/Izumiko/iwaradl) - [MIT License](https://opensource.org/licenses/MIT) CLI Iwara video downloader
