declare namespace Aria2 {
    interface IResult {
        id: string,
        jsonrpc: string,
        error: undefined | string,
        result?: any
    }

    interface StartsResult extends IResult {
        result: Array<Status>
    }

    interface TellStatusResult extends IResult {
        result: Status
    }

    interface AuctionResult extends IResult {
        result: string
    }

    interface GlobalStatResult extends IResult {
        result: {
            downloadSpeed: string
            numActive: string
            numWaiting: string
            numStopped: string
            numStoppedTotal: string
        }
    }

    interface GlobalOptionResult extends IResult {
        result: {
            'max-concurrent-downloads': string
            [key: string]: string
        }
    }

    interface Uri {
        uri: string;
        status: 'used' | 'waiting';
    }

    interface File {
        index: string;
        path: string;
        length: string;
        completedLength: string;
        selected: 'true' | 'false';
        uris: Uri[];
    }
    interface Status {
        gid: string;
        status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
        totalLength: string;
        completedLength: string;
        uploadLength: string;
        bitfield: string;
        downloadSpeed: string;
        uploadSpeed: string;
        infoHash: string;
        numSeeders: string;
        seeder: 'true' | 'false';
        pieceLength: string;
        numPieces: string;
        connections: string;
        errorCode: string;
        errorMessage: string;
        followedBy: string[];
        following: string;
        belongTo: string;
        dir: string;
        files: File[];
        bittorrent: any;
        verifiedLength: string;
        verifyIntegrityPending: string;
    }
}