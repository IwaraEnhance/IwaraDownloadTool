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
        locale: null
        seenAt: string
        avatar?: Avatar
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
    interface IPage {
        count: number
        limit: number
        page: number
        results: IResult[]
    }

    interface Playlist extends IResult {
        playlist: {
            id: string;
            title: string;
            thumbnail: string | null;
            numVideos: number;
            user: User;
            siteId: string;
        };
    }

    interface IResult {
        id?: string
        createdAt?: string
        updatedAt?: string
        user?: User,
        message?: string | null
    }

    interface Comment extends IResult {
        body: string
        numReplies: number
        videoId: string
    }

    interface TagBlacklist {
        id: string;
        type: string;
        sensitive: boolean;
    }

    interface Notification {
        mention: boolean;
        reply: boolean;
        comment: boolean;
    }
    interface LocalUser {
        balance: number;
        user: User;
        tagBlacklist: TagBlacklist[];
        profile: Profile;
        notifications: Notification;
    }
    interface Profile extends IResult {
        user: User
    }

    interface Video extends IResult {
        id: string
        slug: string
        title: string
        body: string | undefined
        status: string
        rating: string
        private: boolean
        unlisted: boolean
        thumbnail: number
        embedUrl: string | undefined
        liked: boolean
        numLikes: number
        numViews: number
        numComments: number
        file: File
        user: User,
        customThumbnail: any
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