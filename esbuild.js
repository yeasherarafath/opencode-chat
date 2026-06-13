const esbuild = require("esbuild");
const path = require("path");

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");

async function build() {
  const extConfig = {
    entryPoints: [path.resolve(__dirname, "src/extension.ts")],
    bundle: true,
    outfile: path.resolve(__dirname, "dist/extension.js"),
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    sourcemap: true,
    minify: false,
  };

  const webviewConfig = {
    entryPoints: [path.resolve(__dirname, "src/webview/app.ts")],
    bundle: true,
    outfile: path.resolve(__dirname, "dist/webview.js"),
    format: "iife",
    platform: "browser",
    sourcemap: true,
    minify: false,
  };

  if (isWatch) {
    const extCtx = await esbuild.context(extConfig);
    const wvCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), wvCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extConfig),
      esbuild.build(webviewConfig),
    ]);
    console.log("Build complete: dist/extension.js + dist/webview.js");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
