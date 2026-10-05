import {fetchPost, getFrontend} from "siyuan";
import {debug} from "./logger";

export interface IBazaarAvailable {
    repoURL: string;
    /** 集市索引里的版本，本插件判定「最新」的唯一依据。 */
    version: string;
}

/**
 * 读集市下发的包信息。
 * 不用 GitHub 自己标的 latest：集市还没检索到的版本不算已知最新，
 * 所以「最新」一律以这里的 version 为准。
 */
export const fetchBazaarAvailable = (packageType: string, packageName: string): Promise<IBazaarAvailable | undefined> =>
    new Promise((resolve) => {
        const started = Date.now();
        fetchPost("/api/bazaar/getBazaarPackage", {
            frontend: getFrontend(),
            packageType,
            packageName,
        }, (response) => {
            const available = response.code === 0 ? response.data.available : undefined;
            debug("bazaar: /api/bazaar/getBazaarPackage answered", {
                packageType,
                packageName,
                code: response.code,
                msg: response.msg,
                elapsed: Date.now() - started,
                available: available ? {repoURL: available.repoURL, version: available.version} : undefined,
            });
            resolve(available ? {repoURL: available.repoURL, version: available.version} : undefined);
        });
    });
