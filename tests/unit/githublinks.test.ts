// @vitest-environment node
import {describe, expect, it} from "vitest";
import {
    blobURL,
    classifyGitHubLink,
    commitsURL,
    compareWebURL,
    releaseURL,
    repoWebURL,
} from "../../src/ui/githublinks";

const REPO = "owner/repo";

describe("仓库网页地址", () => {
    it("仓库首页", () => {
        expect(repoWebURL(REPO)).toBe("https://github.com/owner/repo");
    });

    it("发行版页面", () => {
        expect(releaseURL(REPO, "v1.2.3")).toBe("https://github.com/owner/repo/releases/tag/v1.2.3");
        expect(releaseURL(REPO, "")).toBe("https://github.com/owner/repo/releases");
    });

    it("发行版 tag 会被编码", () => {
        expect(releaseURL(REPO, "release/1.2.3")).toBe("https://github.com/owner/repo/releases/tag/release%2F1.2.3");
    });

    it("文件地址用 HEAD 当 ref", () => {
        expect(blobURL(REPO, "docs/CHANGELOG.md")).toBe("https://github.com/owner/repo/blob/HEAD/docs/CHANGELOG.md");
    });

    it("提交对比地址", () => {
        expect(compareWebURL(REPO, "v1.0.0", "v1.1.0"))
            .toBe("https://github.com/owner/repo/compare/v1.0.0...v1.1.0");
    });

    it("提交列表地址：空值与 HEAD 都指向默认分支", () => {
        expect(commitsURL(REPO, "")).toBe("https://github.com/owner/repo/commits");
        expect(commitsURL(REPO, "HEAD")).toBe("https://github.com/owner/repo/commits");
        expect(commitsURL(REPO, "v1.2.3")).toBe("https://github.com/owner/repo/commits/v1.2.3");
    });
});

describe("classifyGitHubLink", () => {
    it("认出仓库里的 changelog 文件", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/HEAD/CHANGELOG.md", REPO))
            .toEqual({type: "changelog"});
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/main/docs/CHANGELOG.md", REPO))
            .toEqual({type: "changelog"});
    });

    it("changelog 文件名不区分大小写，也可以带查询串", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/HEAD/changelog.md?plain=1", REPO))
            .toEqual({type: "changelog"});
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/HEAD/Changelog.MD", REPO))
            .toEqual({type: "changelog"});
    });

    it("文件名编码过也能认出来", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/HEAD/docs/CHANGELOG%2Emd", REPO))
            .toEqual({type: "changelog"});
    });

    it("其他文件不接管", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/HEAD/README.md", REPO)).toBeUndefined();
        expect(classifyGitHubLink("https://github.com/owner/repo/blob/HEAD/CHANGELOG.md.bak", REPO)).toBeUndefined();
    });

    it("发行版页面带上 tag", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/releases/tag/v1.2.3", REPO))
            .toEqual({type: "release", tag: "v1.2.3"});
    });

    it("发行版 tag 会被解码", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/releases/tag/release%2F1.2.3", REPO))
            .toEqual({type: "release", tag: "release/1.2.3"});
    });

    it("发行版列表页的 tag 为空", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/releases", REPO))
            .toEqual({type: "release", tag: ""});
        expect(classifyGitHubLink("https://github.com/owner/repo/releases/", REPO))
            .toEqual({type: "release", tag: ""});
    });

    it("提交对比支持 ... 与 ..", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/compare/v1.0.0...v1.1.0", REPO))
            .toEqual({type: "commits", base: "v1.0.0", head: "v1.1.0"});
        expect(classifyGitHubLink("https://github.com/owner/repo/compare/v1.0.0..v1.1.0", REPO))
            .toEqual({type: "commits", base: "v1.0.0", head: "v1.1.0"});
    });

    it("对比范围会被解码", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/compare/release%2F1.0...release%2F1.1", REPO))
            .toEqual({type: "commits", base: "release/1.0", head: "release/1.1"});
    });

    it("缺一端或语法不对的对比地址不接管", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo/compare/", REPO)).toBeUndefined();
        expect(classifyGitHubLink("https://github.com/owner/repo/compare/v1.0.0", REPO)).toBeUndefined();
    });

    it("不是 GitHub 的地址不接管", () => {
        expect(classifyGitHubLink("https://gitlab.com/owner/repo/releases/tag/v1", REPO)).toBeUndefined();
        expect(classifyGitHubLink("ftp://github.com/owner/repo/releases/tag/v1", REPO)).toBeUndefined();
        expect(classifyGitHubLink("not a url", REPO)).toBeUndefined();
    });

    it("别的仓库不接管", () => {
        expect(classifyGitHubLink("https://github.com/other/repo/releases/tag/v1", REPO)).toBeUndefined();
        expect(classifyGitHubLink("https://github.com/owner/repo-extra/releases/tag/v1", REPO)).toBeUndefined();
    });

    it("仓库首页、issue 与单条提交不接管", () => {
        expect(classifyGitHubLink("https://github.com/owner/repo", REPO)).toBeUndefined();
        expect(classifyGitHubLink("https://github.com/owner/repo/issues/12", REPO)).toBeUndefined();
        expect(classifyGitHubLink("https://github.com/owner/repo/commit/abcdef", REPO)).toBeUndefined();
    });

    it("仓库名大小写不敏感", () => {
        expect(classifyGitHubLink("https://github.com/Owner/Repo/releases/tag/v1", REPO))
            .toEqual({type: "release", tag: "v1"});
    });
});
