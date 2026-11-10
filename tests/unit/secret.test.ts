// @vitest-environment node
import {webcrypto} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";

type SecretModule = typeof import("../../src/core/secret");

let secret: SecretModule;

beforeEach(async () => {
    // jsdom 的 crypto 不一定有 SubtleCrypto，用 Node 的实现保证测试环境一致
    vi.stubGlobal("crypto", webcrypto);
    vi.resetModules();
    secret = await import("../../src/core/secret");
});

describe("令牌加密", () => {
    it("加密再解密能拿回原文", async () => {
        const key = await secret.createSecretKey();
        const blob = await secret.encryptSecret("ghp_测试_token", key);
        expect(await secret.decryptSecret(blob, key)).toBe("ghp_测试_token");
    });

    it("导出再导入的钥匙仍然可用", async () => {
        const key = await secret.createSecretKey();
        const blob = await secret.encryptSecret("ghp_test", key);
        const restored = await secret.importSecretKey(await secret.exportSecretKey(key));
        expect(await secret.decryptSecret(blob, restored)).toBe("ghp_test");
    });

    it("密文格式是 v1:iv:data", async () => {
        const key = await secret.createSecretKey();
        const blob = await secret.encryptSecret("ghp_test", key);
        const parts = blob.split(":");
        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe("v1");
        expect(parts[1].length).toBeGreaterThan(0);
        expect(parts[2].length).toBeGreaterThan(0);
        expect(blob).not.toContain("ghp_test");
    });

    it("每次加密的 iv 都不同", async () => {
        const key = await secret.createSecretKey();
        const first = await secret.encryptSecret("same", key);
        const second = await secret.encryptSecret("same", key);
        expect(first).not.toBe(second);
        expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
    });

    it("换一把钥匙解不开", async () => {
        const blob = await secret.encryptSecret("ghp_test", await secret.createSecretKey());
        await expect(secret.decryptSecret(blob, await secret.createSecretKey())).rejects.toThrow();
    });

    it("格式不对时明确报错", async () => {
        const key = await secret.createSecretKey();
        await expect(secret.decryptSecret("ghp_plain", key)).rejects.toThrow("unexpected token format");
        await expect(secret.decryptSecret("v2:a:b", key)).rejects.toThrow("unexpected token format");
        await expect(secret.decryptSecret("v1::", key)).rejects.toThrow("unexpected token format");
    });

    it("密文被改过就解不开", async () => {
        const key = await secret.createSecretKey();
        const blob = await secret.encryptSecret("ghp_test", key);
        const [version, iv, data] = blob.split(":");
        const tampered = [version, iv, data.slice(0, -4) + "AAAA"].join(":");
        await expect(secret.decryptSecret(tampered, key)).rejects.toThrow();
    });
});
