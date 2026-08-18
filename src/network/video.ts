import '../core/env'
import { isNullOrUndefined, stringify } from '../core/env'
import { i18nList } from '../i18n'
import { ToastType } from '../core/enum'
import { config } from '../core/config'
import { unlimitedFetch } from '../core/extension'
import { createLogger } from '../core/log'
import { db } from '../core/db'
import { getAuth, refreshToken } from './auth'
import { newToast, toastNode } from '../ui/notify'

const log = createLogger('Video')
import { apiEndpoint } from '../main'

async function getCommentData(id: string, commentID?: string, page: number = 0): Promise<Iwara.IPage> {
    return (await (await unlimitedFetch(`https://${apiEndpoint}/video/${id}/comments?page=${page}${!isNullOrUndefined(commentID) && !commentID.isEmpty() ? '&parent=' + commentID : ''}`, { headers: await getAuth() })).json()) as Iwara.IPage
}
async function getCommentDatas(id: string, commentID?: string): Promise<Iwara.Comment[]> {
    let comments: Iwara.Comment[] = []
    let base = await getCommentData(id, commentID)
    comments.push(...(base.results as Iwara.Comment[]))
    for (let page = 1; page < Math.ceil(base.count / base.limit); page++) {
        comments.push(...((await getCommentData(id, commentID, page)).results as Iwara.Comment[]))
    }
    let replies: Iwara.Comment[] = []
    for (let index = 0; index < comments.length; index++) {
        const comment = comments[index]
        if (comment.numReplies > 0) {
            replies.push(...(await getCommentDatas(id, comment.id)))
        }
    }
    comments.push(...replies)
    return comments
}

export async function parseVideoInfo(info: VideoInfo): Promise<FullVideoInfo | PartialVideoInfo | FailVideoInfo> {
    let ID: string = info.ID
    let Type: VideoInfoType = info.Type
    let RAW: Iwara.Video | undefined = info.RAW
    try {
        switch (info.Type) {
            case 'cache':
                RAW = info.RAW
                ID = RAW.id
                Type = 'partial'
                break
            case 'init':
            case 'fail':
            case 'partial':
            case 'full':
                log.debug('try parse full source')
                let sourceResult = (await (
                    await unlimitedFetch(
                        `https://${apiEndpoint}/video/${info.ID}`,
                        {
                            headers: await getAuth()
                        },
                        {
                            retry: true,
                            maxRetries: 3,
                            failStatus: [403, 404],
                            retryDelay: 1000,
                            onRetry: async () => {
                                await refreshToken()
                            },
                            onFail: async (response) => {
                                log.debug(`${response.url} Fail, response: ${await response.clone().text()}`)
                            }
                        }
                    )
                ).json()) as Iwara.IResult
                if (isNullOrUndefined(sourceResult.id)) {
                    Type = 'fail'
                    return {
                        ID,
                        Type,
                        RAW,
                        Msg: sourceResult.message ?? stringify(sourceResult)
                    }
                }
                RAW = sourceResult as Iwara.Video
                ID = RAW.id
                Type = 'full'
                break
            default:
                Type = 'fail'
                return {
                    ID,
                    Type,
                    RAW,
                    Msg: 'Unknown type'
                }
        }
    } catch (error) {
        newToast(ToastType.Error, {
            node: toastNode([`${info.RAW?.title}[${ID}] %#parsingFailed#%`], '%#createTask#%'),
            async onClick() {
                this.hide()
            }
        }).show()
        Type = 'fail'
        return {
            ID,
            Type,
            RAW,
            Msg: stringify(error)
        }
    }

    let FileName: string
    let Size: number
    let External: boolean
    let ExternalUrl: string | undefined
    let Description: string | undefined
    let DownloadQuality: string
    let DownloadUrl: string
    let Comments: string
    let UploadTime: number
    let Title: string
    let Tags: Iwara.Tag[]
    let Liked: boolean
    let Alias: string
    let Author: string
    let AuthorID: string
    let Private: boolean
    let Unlisted: boolean
    let Following: boolean
    let Friend: boolean

    UploadTime = new Date(RAW.createdAt ?? 0).getTime()
    Title = RAW.title
    Tags = RAW.tags
    Liked = RAW.liked
    Alias = RAW.user.name
    Author = RAW.user.username
    AuthorID = RAW.user.id
    Private = RAW.private
    Unlisted = RAW.unlisted

    External = !isNullOrUndefined(RAW.embedUrl) && !RAW.embedUrl.isEmpty()
    ExternalUrl = RAW.embedUrl

    if (External) {
        Type = 'fail'
        return {
            Type,
            RAW,
            ID,
            Alias,
            Author,
            AuthorID,
            Private,
            UploadTime,
            Title,
            Tags,
            Liked,
            External,
            ExternalUrl,
            Description,
            Unlisted,
            Msg: 'external Video'
        }
    }

    try {
        switch (Type) {
            case 'full':
                Following = RAW.user.following
                Friend = RAW.user.friend

                if (Following) {
                    await db.putFollow(RAW.user)
                } else {
                    await db.deleteFollow(AuthorID)
                }

                if (Friend) {
                    await db.putFriend(RAW.user)
                } else {
                    await db.deleteFriend(AuthorID)
                }

                Description = RAW.body
                FileName = RAW.file.name
                Size = RAW.file.size
                let VideoFileSource = ((await (await unlimitedFetch(RAW.fileUrl, { headers: await getAuth(RAW.fileUrl) })).json()) as Iwara.Source[]).sort((a, b) => (!isNullOrUndefined(config.priority[b.name]) ? config.priority[b.name] : 0) - (!isNullOrUndefined(config.priority[a.name]) ? config.priority[a.name] : 0))
                if (isNullOrUndefined(VideoFileSource) || !(VideoFileSource instanceof Array) || VideoFileSource.length < 1) throw new Error(i18nList[config.language].getVideoSourceFailed.toString())
                DownloadQuality = config.checkPriority ? config.downloadPriority : VideoFileSource[0].name
                let fileList = VideoFileSource.filter((x) => x.name === DownloadQuality)
                if (!fileList.any()) throw new Error(i18nList[config.language].noAvailableVideoSource.toString())

                let Source = fileList[Math.floor(Math.random() * fileList.length)].src.download
                if (isNullOrUndefined(Source) || Source.isEmpty()) throw new Error(i18nList[config.language].videoSourceNotAvailable.toString())

                DownloadUrl = decodeURIComponent(`https:${Source}`)

                log.debug('try parse all comment')
                Comments = JSON.stringify(await getCommentDatas(ID)).normalize('NFKC')

                return {
                    Type,
                    RAW,
                    ID,
                    Alias,
                    Author,
                    AuthorID,
                    Private,
                    UploadTime,
                    Title,
                    Tags,
                    Liked,
                    External,
                    FileName,
                    DownloadQuality,
                    ExternalUrl,
                    Description,
                    Comments,
                    DownloadUrl,
                    Size,
                    Following,
                    Unlisted,
                    Friend
                }
            case 'partial':
                return {
                    Type,
                    RAW,
                    ID,
                    Alias,
                    Author,
                    AuthorID,
                    UploadTime,
                    Title,
                    Tags,
                    Liked,
                    External,
                    ExternalUrl,
                    Unlisted,
                    Private
                }
            default:
                Type = 'fail'
                return {
                    Type,
                    RAW,
                    ID,
                    Alias,
                    Author,
                    AuthorID,
                    Private,
                    UploadTime,
                    Title,
                    Tags,
                    Liked,
                    External,
                    ExternalUrl,
                    Description,
                    Unlisted,
                    Msg: 'Unknown type'
                }
        }
    } catch (error) {
        Type = 'fail'
        return {
            Type,
            RAW,
            ID,
            Alias,
            Author,
            AuthorID,
            Private,
            UploadTime,
            Title,
            Tags,
            Liked,
            External,
            ExternalUrl,
            Description,
            Unlisted,
            Msg: stringify(error)
        }
    }
}

/**
 * 计算 VideoInfo 的信息完整度分数
 * 排序依据（从高到低）：full > partial > cache > init > fail
 * @param {VideoInfo} info - 视频信息对象
 * @returns {number} 完整度分数
 */
export function getVideoInfoCompleteness(info: VideoInfo): number {
    switch (info.Type) {
        case 'full':
            return 5
        case 'partial':
            return 4
        case 'fail':
            return 3
        case 'cache':
            return 2
        case 'init':
            return 1
    }
}

/**
 * 从两个 VideoInfo 中返回信息更完整的那一个
 * 适用于同一直视频的不同版本（如缓存 vs 完整解析后）择优保留
 * @param {VideoInfo} a - 版本 A
 * @param {VideoInfo} b - 版本 B
 * @returns {VideoInfo} 信息更完整的 VideoInfo
 * @throws {Error} 如果 ID 不同则抛出异常
 */
export function getMoreCompleteVideoInfo(a: VideoInfo, b: VideoInfo): VideoInfo {
    if (a.ID !== b.ID) throw new Error(`VideoInfo ID mismatch: "${a.ID}" vs "${b.ID}"`)
    const completenessA = getVideoInfoCompleteness(a)
    const completenessB = getVideoInfoCompleteness(b)
    return completenessB > completenessA ? b : a
}
