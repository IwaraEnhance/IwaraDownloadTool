export enum DownloadType {
    Aria2,
    Iwaradl,
    Browser,
    Others
}
export enum PageType {
    Video = 'video',
    Image = 'image',
    VideoList = 'videoList',
    ImageList = 'imageList',
    Forum = 'forum',
    ForumSection = 'forumSection',
    ForumThread = 'forumThread',
    Page = 'page',
    Home = 'home',
    Profile = 'profile',
    Subscriptions = 'subscriptions',
    Playlist = 'playlist',
    Favorites = 'favorites',
    Search = 'search',
    Account = 'account'
}
export enum ToastType {
    Log,
    Info,
    Warn,
    Error
}
export enum MessageType {
    Close,
    Request,
    Receive,
    Set,
    Del
}
export enum VersionState {
    Low,
    Equal,
    High
}