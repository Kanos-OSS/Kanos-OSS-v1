import { build as esbuild } from "esbuild";
import { rm, readFile } from "fs/promises";

// Bundle the server (our own source) into a single CJS file.
// All third-party dependencies are kept external and resolved from
// node_modules at runtime, which avoids bundling issues with native
// modules (pg) and keeps the build fast and predictable.
async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const externals = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    packages: "external",
    external: externals,
    logLevel: "info",
  });

  console.log("done -> dist/index.cjs");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
