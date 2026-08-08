/**
 * 国际化字符串接口
 * 键值对结构，值可以是:
 * - 渲染代码对象
 * - 字符串
 * - 上述类型的数组
 */
declare interface I18N {
    [key: string]: RenderCode<any> | string | (RenderCode<any> | string)[]
}

declare interface PageEvent {
    type: 'join' | 'leave' | 'suicide'
    id: string
}

declare type VectorClock = Record<string, number>;
declare interface VCMessageBase {
    type: MessageType
    id: string
    vectorClock: VectorClock
    wallClock: number
}

declare type VCMessage<T> =
    | (VCMessageBase & { type: 'sync' })
    | (VCMessageBase & { type: 'state'; state: Array<[string, T]> })
    | (VCMessageBase & { type: 'set'; key: string; value: T })
    | (VCMessageBase & { type: 'delete'; key: string })

/** 内部使用的消息条目类型 */
declare type MessageType = 'sync' | 'state' | 'set' | 'delete'

declare interface MessageBase {
    type: MessageType
    id: string
    timestamp: number
    lifetime: number
}

declare type Message<T> =
    | SyncMessage
    | StateMessage<T>
    | SetMessage<T>
    | DeleteMessage

interface SyncMessage extends MessageBase {
    type: 'sync'
}
interface StateMessage<T> extends MessageBase {
    type: 'state'
    state: Array<[string, T]>
}
interface SetMessage<T> extends MessageBase {
    type: 'set'
    key: string
    value: T
}
interface DeleteMessage extends MessageBase {
    type: 'delete'
    key: string
}
/**
 * 渲染代码接口，用于描述DOM元素结构
 * @template T HTML元素标签名
 */
declare interface RenderCode<T extends keyof HTMLElementTagNameMap> {
    nodeType: T;
    attributes?: Record<string, any>;
    events?: Record<string, EventListenerOrEventListenerObject>;
    className?: string | string[];
    childs?: RenderCode<any> | string | undefined | (RenderCode<any> | string | undefined)[];
}
/**
 * HTML input元素的type属性所有可能值
 */
declare type InputType =
    | "button"
    | "checkbox"
    | "color"
    | "date"
    | "datetime-local"
    | "email"
    | "file"
    | "hidden"
    | "image"
    | "month"
    | "number"
    | "password"
    | "radio"
    | "range"
    | "reset"
    | "search"
    | "submit"
    | "tel"
    | "text"
    | "time"
    | "url"
    | "week";
/**
 * 递归修剪类型，移除所有null/undefined属性
 * @template T 原始类型
 */
declare type Pruned<T> =
    T extends null | undefined
    ? never
    : T extends readonly any[]
    ? number extends T['length']
    ? Array<Pruned<T[number]>>
    : { [K in keyof T]: Pruned<T[K]> }
    : T extends object
    ? { [K in keyof T as Pruned<T[K]> extends never ? never : K]: Pruned<T[K]> }
    : T;

declare type ThrottleOptions = {
    /** 
     * 是否在节流开始时立即执行
     * @default true
     */
    leading?: boolean
    /** 
     * 是否在节流结束后追加执行
     * @default true 
     */
    trailing?: boolean
}
declare type DebounceOptions = {
    /** 
     * 是否立即执行首次调用
     * @default false 
     */
    immediate?: boolean
}
declare enum DownloadType {
    Aria2,
    Iwaradl,
    Browser,
    Others
}
declare interface ImportConfig {
    language: import('../i18n').Language;
    autoFollow: boolean;
    autoLike: boolean;
    autoCopySaveFileName: boolean;
    autoDownloadMetadata: boolean;
    enableUnsafeMode: boolean;
    enableBeautify: boolean;
    enableWidescreen: boolean;
    experimentalFeatures: boolean;
    autoInjectCheckbox: boolean;
    checkDownloadLink: boolean;
    filterLikedVideos: boolean;
    checkPriority: boolean;
    addUnlistedAndPrivate: boolean;
    filterUnlistedAndPrivate: boolean;
    autoCollapseMenu: boolean;
    downloadPriority: keyof Record<string, number>;
    downloadType: DownloadType;
    downloadPath: string;
    downloadProxy: string;
    downloadProxyUsername: string;
    downloadProxyPassword: string;
    aria2Path: string;
    aria2Token: string;
    iwaradlPath: string;
    iwaradlToken: string;
    mediaCenterApi: string;
    mediaCenterApiKey: string;
    pathNormalize: boolean;
    pathReplaceEmojis: boolean;
    pathFoldMarks: boolean;
    pathSanitize: boolean;
    pathTruncate: boolean;
    pathTitleMaxLength: number;
    pathAliasMaxLength: number;
    priority: Record<string, number>;
}
/**
 * 本地路径信息接口
 * 描述文件路径的各个组成部分
 */
declare interface LocalPath {
    fullPath: string;
    fullName: string;
    directory: string;
    type: 'Windows' | 'Unix' | 'Relative';
    extension: string;
    baseName: string;
}

declare type VideoInfoType = 'full' | 'partial' | 'cache' | 'init' | 'fail'

declare interface VideoInfoBase {
    Type: VideoInfoType;
    ID: string;
    RAW?: Iwara.Video;
}

declare type VideoInfo =
    | FullVideoInfo
    | PartialVideoInfo
    | CacheVideoInfo
    | InitVideoInfo
    | FailVideoInfo

interface InitVideoInfo extends VideoInfoBase {
    Type: 'init';
    UploadTime?: number;
    Title?: string;
    FileName?: string;
    Size?: number;
    Tags?: Array<Iwara.Tag>;
    Liked?: boolean;
    Following?: boolean;
    Friend?: boolean;
    Alias?: string;
    Author?: string;
    AuthorID?: string;
    Private?: boolean;
    Unlisted?: boolean;
    DownloadQuality?: string;
    External?: boolean;
    ExternalUrl?: string;
    Description?: string;
    Comments?: string;
    DownloadUrl?: string;
    RAW?: Iwara.Video;
}

interface FullVideoInfo extends VideoInfoBase {
    Type: 'full';
    UploadTime: number;
    Title: string;
    FileName: string;
    Size: number;
    Tags: Array<Iwara.Tag>;
    Liked: boolean;
    Following: boolean;
    Friend: boolean;
    Alias: string;
    Author: string;
    AuthorID: string;
    Private: boolean;
    Unlisted: boolean;
    DownloadQuality: string;
    External: boolean;
    ExternalUrl?: string;
    Description?: string;
    Comments: string;
    DownloadUrl: string;
    RAW: Iwara.Video;
}
interface PartialVideoInfo extends VideoInfoBase {
    Type: 'partial'
    UploadTime: number;
    Title: string;
    Tags: Array<Iwara.Tag>;
    Liked: boolean;
    Alias: string;
    Author: string;
    AuthorID: string;
    Private: boolean;
    Unlisted: boolean;
    External: boolean;
    ExternalUrl?: string;
    RAW: Iwara.Video;
}

interface CacheVideoInfo extends VideoInfoBase {
    Type: 'cache'
    RAW: Iwara.Video;
}

interface FailVideoInfo extends VideoInfoBase {
    Type: 'fail';
    Msg?: string;
    UploadTime?: number;
    Title?: string;
    FileName?: string;
    Size?: number;
    Tags?: Array<Iwara.Tag>;
    Liked?: boolean;
    Following?: boolean;
    Friend?: boolean;
    Alias?: string;
    Author?: string;
    AuthorID?: string;
    Private?: boolean;
    Unlisted?: boolean;
    DownloadQuality?: string;
    External?: boolean;
    ExternalUrl?: string;
    Description?: string;
    Comments?: string;
    DownloadUrl?: string;
    RAW?: Iwara.Video;
}
