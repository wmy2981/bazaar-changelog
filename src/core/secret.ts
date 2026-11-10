/**
 * 令牌落盘前的加密。
 *
 * 浏览器环境里没有系统密钥环可用，插件能做的只有「不明文」：随机生成一把 AES-GCM 钥匙，
 * 密文与钥匙分别存进插件私有存储的两个文件。这挡不住能读到整个存储目录的人，但设置文件
 * 被单独贴出来（提 issue、贴配置）时不会连带泄漏令牌。钥匙每次保存都换新的。
 */
const KEY_ALGORITHM: AesKeyAlgorithm = {name: "AES-GCM", length: 256};
const KEY_USAGE: KeyUsage[] = ["encrypt", "decrypt"];

const toBase64 = (bytes: ArrayBuffer): string => {
    const view = new Uint8Array(bytes);
    let binary = "";
    for (const byte of view) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
};

const fromBase64 = (value: string): ArrayBuffer => {
    const binary = atob(value);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
};

/** TextEncoder 给的是 ArrayBufferLike，crypto.subtle 要的是 BufferSource，这里统一成 ArrayBuffer。 */
const encode = (plain: string): ArrayBuffer => {
    const bytes = new TextEncoder().encode(plain);
    return bytes.buffer as ArrayBuffer;
};

export const createSecretKey = (): Promise<CryptoKey> => crypto.subtle.generateKey(KEY_ALGORITHM, true, KEY_USAGE);

export const exportSecretKey = async (key: CryptoKey): Promise<string> =>
    toBase64(await crypto.subtle.exportKey("raw", key));

export const importSecretKey = (raw: string): Promise<CryptoKey> =>
    crypto.subtle.importKey("raw", fromBase64(raw), KEY_ALGORITHM, false, ["decrypt"]);

/** 返回 `v1:<iv>:<密文>`，两者都用 base64，和钥匙一起才解得开。 */
export const encryptSecret = async (plain: string, key: CryptoKey): Promise<string> => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, encode(plain));
    return `v1:${toBase64(iv.buffer)}:${toBase64(data)}`;
};

export const decryptSecret = async (blob: string, key: CryptoKey): Promise<string> => {
    const [version, iv, data] = blob.split(":");
    if (version !== "v1" || !iv || !data) {
        throw new Error("unexpected token format");
    }
    const plain = await crypto.subtle.decrypt({name: "AES-GCM", iv: fromBase64(iv)}, key, fromBase64(data));
    return new TextDecoder().decode(plain);
};
