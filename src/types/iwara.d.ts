declare namespace Iwara {
    interface Avatar {
        id: string
        type: string
        path: string
        name: string
        mime: string
        size: number
        width?: number
        height?: number
        duration: null
        numThumbnails: null
        animatedPreview: boolean
        createdAt: string
        updatedAt: string
    }
    interface User {
        id: string
        name: string
        username: string
        status: string
        role: string
        followedBy: boolean
        following: boolean
        friend: boolean
        premium: boolean
        /** 用户界面语言（如 "zh"/"en"），未设置时为 null */
        locale: string | null
        seenAt: string
        /** 头像；未上传时为 null */
        avatar: Avatar | null
        createdAt: string
        updatedAt: string
    }
    interface File {
        id: string
        type: string
        path: string
        name: string
        mime: string
        size: number
        width: number | null
        height: number | null
        duration: number
        numThumbnails: number
        animatedPreview: boolean
        createdAt: string
        updatedAt: string
    }
    interface Tag {
        id: string
        type: string
    }
    /** Iwara 官方统一分页响应：所有列表类端点（videos/comments/friends/requests/conversations/notifications 等）
     * 均返回此同构结构，results 类型由端点决定，故参数化 */
    interface IPage<T = IResult> {
        count: number
        limit: number
        page: number
        results: T[]
    }

    /** 好友请求条目（GET /user/:me/friends/requests 返回项） */
    interface FriendRequestEntry {
        id: string
        createdAt: string
        /** 发起请求的一方 */
        user: User
        /** 接收请求的一方（请求条目归属者） */
        target: User
    }

    /** 好友请求列表响应（GET /user/:me/friends/requests，IPage 同构） */
    interface FriendRequestsPage extends IPage<FriendRequestEntry> { }

    interface Playlist extends IResult {
        playlist: {
            id: string
            title: string
            thumbnail: string | null
            numVideos: number
            user: User
            siteId: string
        }
    }

    interface IResult {
        id?: string
        createdAt?: string
        updatedAt?: string
        user?: User
        message?: string | null
    }

    interface Comment extends IResult {
        body: string
        numReplies: number
        videoId: string
    }

    interface TagBlacklist {
        id: string
        type: string
        sensitive: boolean
    }

    interface Notification {
        mention: boolean
        reply: boolean
        comment: boolean
    }
    interface LocalUser {
        balance: number
        user: User
        tagBlacklist: TagBlacklist[]
        profile: Profile
        notifications: Notification
    }
    interface Profile extends IResult {
        user: User
    }

    interface Video extends IResult {
        id: string
        slug: string
        title: string
        /** 视频描述；官方对无描述视频返回 null */
        body: string | null
        status: string
        rating: string
        private: boolean
        unlisted: boolean
        thumbnail: number
        /** 外链嵌入地址（外站视频）；站内视频为 null */
        embedUrl: string | null
        liked: boolean
        numLikes: number
        numViews: number
        numComments: number
        file: File
        user: User
        /** 自定义缩略图；未设置时为 null */
        customThumbnail: File | null
        tags: Tag[]
        fileUrl: string
    }

    interface Source {
        id: string
        name: string
        src: {
            view: string
            download: string
        }
        createdAt: string
        updatedAt: string
        type: string
    }
}
