const path = require("path");
const fs = require("fs");
const webpack = require("webpack");
const {EsbuildPlugin} = require("esbuild-loader");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const ZipPlugin = require("zip-webpack-plugin");
const pluginManifest = require("./plugin.json");

// 图标与预览图放 assets/，打包后落在包根；还没生成时先跳过，由 npm run icon / preview 产图。
const packageImages = ["icon", "preview"]
    .map((field) => pluginManifest[field])
    .filter((name) => name && fs.existsSync(path.join("assets", name)))
    .map((name) => ({from: path.join("assets", name), to: "./dist/"}));

// dev 只写仓库根（watch 用），build 才写 dist/ 与 package.zip；两者产物都不入库。
module.exports = (env, argv) => {
    const production = argv.mode === "production";
    const plugins = [
        new MiniCssExtractPlugin({
            filename: production ? "dist/index.css" : "index.css",
        }),
    ];
    if (production) {
        plugins.push(
            new webpack.BannerPlugin({
                banner: () => fs.readFileSync("LICENSE").toString(),
            }),
            new CopyPlugin({
                patterns: [
                    ...packageImages,
                    {from: "plugin.json", to: "./dist/"},
                    {from: "README.md", to: "./dist/"},
                    {from: "README.zh-CN.md", to: "./dist/"},
                    {from: "LICENSE", to: "./dist/"},
                    {from: "src/i18n/", to: "./dist/i18n/"},
                ],
            }),
            new ZipPlugin({
                filename: "package.zip",
                include: [/dist/],
                pathMapper: (assetPath) => assetPath.replace("dist/", ""),
            }),
        );
    } else {
        plugins.push(
            new CopyPlugin({
                patterns: [
                    {from: "src/i18n/", to: "./i18n/"},
                ],
            }),
        );
    }
    return {
        mode: argv.mode || "development",
        entry: {
            [production ? "dist/index" : "index"]: "./src/index.ts",
        },
        output: {
            filename: "[name].js",
            path: path.resolve(__dirname),
            // 思源用 eval 执行插件包，必须是 CommonJS
            library: {type: "commonjs2"},
        },
        // siyuan 由宿主注入，绝不打包
        externals: {siyuan: "siyuan"},
        devtool: production ? false : "eval-source-map",
        optimization: {
            minimize: production,
            minimizer: [new EsbuildPlugin()],
        },
        resolve: {
            extensions: [".ts", ".scss", ".js", ".json"],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [{loader: "esbuild-loader", options: {target: "es2021"}}],
                },
                {
                    test: /\.scss$/,
                    include: [path.resolve(__dirname, "src")],
                    use: [MiniCssExtractPlugin.loader, "css-loader", "sass-loader"],
                },
            ],
        },
        plugins,
    };
};
