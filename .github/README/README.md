# Iwara Download Tool

[![GitHub license](https://img.shields.io/github/license/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Star](https://img.shields.io/github/stars/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Star&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)
[![GitHub Fork](https://img.shields.io/github/forks/IwaraEnhance/IwaraDownloadTool.svg?style=flat-square&label=Fork&color=4285dd&logo=github)](https://github.com/IwaraEnhance/IwaraDownloadTool/)

* Batch downloading
* Supports downloader based on Aria2
* Automatically checks if third-party cloud storage links are provided by the author in the video description or comments
* Customizable save location and file names <sup>*Supported only in Aria2 and IwaraDownloader modes; other download modes support file name customization only</sup>
* Automatically follow the authors of selected videos <sup>*Disabled by default, needs to be enabled manually</sup>
* Automatically like/favorite selected videos <sup>*Disabled by default, needs to be enabled manually</sup>
* Forced display of unlisted and private videos <sup>*Requires following the author</sup>
* Supports downloading private videos <sup>*Requires an account that is friends with the author</sup>
* Supports downloading hidden videos <sup>*Requires knowing the video ID</sup>

## Instructions

### Install the Script

* Install from GreasyFork   
 **[Visit](https://sleazyfork.org/scripts/422239)**
* GitHub Release  
 **[Install](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/latest/IwaraDownloadTool.user.js)**
* GitHub Release [Preview Version]  
 **[Install](https://github.com/IwaraEnhance/IwaraDownloadTool/releases/download/preview/IwaraDownloadTool.user.js)**

#### Supported Browsers

* Chrome or Chromium-based browsers (e.g., Edge) <sup>*Version ≥ 85</sup>
* Firefox <sup>*Version ≥ 79</sup>

#### Recommended Script Managers

* Tampermonkey **[Official Website](https://www.tampermonkey.net/)**

#### Detailed Usage Instructions

* [Wiki](https://github.com/IwaraEnhance/IwaraDownloadTool/wiki)

#### Available Path Variables

* Download Time %#NowTime#%
* Upload Time %#UploadTime#%
* Video Title %#TITLE#%
* Video ID %#ID#%
* Video Author %#AUTHOR#%
* Video Author (Nickname) %#ALIAS#%
* Quality %#QUALITY#%

  Example:  
  `%#NowTime:YYYY-MM-DD#%_%#AUTHOR#%_%#UploadTime:YYYY-MM-DD#%_%#TITLE#%_%#QUALITY#%[%#ID#%].MP4`

  Output:

  `2024-02-19_ExampleAuthorID_2024-02-18_ExampleTitle_Source[ExampleID].MP4`

## Dependencies
- [day.js](https://github.com/iamkun/dayjs) - [MIT License](https://opensource.org/licenses/MIT)
- [idb](https://github.com/jakearchibald/idb) - [ISC License](https://opensource.org/license/isc)
- [esbuild](https://github.com/evanw/esbuild) - [MIT License](https://opensource.org/licenses/MIT)
- [emoji-regex](https://github.com/slevithan/emoji-regex-xs) - [MIT License](https://opensource.org/licenses/MIT)
- [aria2rpc](https://github.com/pboymt/aria2rpc)