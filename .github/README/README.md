# Iwara Download Tool

[![GitHub license](https://img.shields.io/github/license/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Star](https://img.shields.io/github/stars/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Star&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Fork](https://img.shields.io/github/forks/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Fork&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)

- Batch downloading
- Supports downloader based on Aria2
- Automatically checks if third-party cloud storage links are provided by the author in the video description or comments
- Customizable save location and file names <sup>\*Supported only in Aria2 and iwaradl modes; other download modes support file name customization only</sup>
- Automatically follow the authors of selected videos <sup>\*Disabled by default, needs to be enabled manually</sup>
- Automatically like/favorite selected videos <sup>\*Disabled by default, needs to be enabled manually</sup>
- Forced display of unlisted and private videos <sup>\*Requires following the author</sup>
- Filters out unlisted and private videos on the subscriptions page <sup>\*Disabled by default, mutually exclusive with forced display</sup>
- Aria2 task auto-tracking: automatically takes over existing tasks and restarts slow ones
- Supports downloading private videos <sup>\*Requires an account that is friends with the author</sup>
- Supports downloading hidden videos <sup>\*Requires knowing the video ID</sup>

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
