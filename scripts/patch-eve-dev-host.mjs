// Patches eve@0.25.x for the Windows/local dev-host crash:
//
//   Cannot find module '<project>\src\internal\authored-module-map-loader.ts'
//   imported from <project>\.eve\dev-hosts\<uuid>\nitro\dev\index.mjs
//
// The nitro dev-host bundle inlines eve's path resolver. Inside the bundle,
// resolvePackageBuildRoot() walks up from the bundle's own location
// (.eve/dev-hosts/...), never finds a `dist` directory, and falls back to
// joining the raw `.ts` source path onto the nearest package root — the
// project root — which doesn't exist in an installed app. Every session then
// dies at createSessionStep before the model is ever called.
//
// Fix: when the walk-up fails, resolve the installed eve package via
// require.resolve and walk up from its real entry point instead. Runs as
// postinstall so the patch survives npm install. Idempotent. Fails loudly if
// eve's code no longer matches (i.e. after an eve upgrade — re-check whether
// upstream fixed it, then update or delete this script).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules/eve/dist/src/internal/application/package.js",
);

const original =
  "function resolvePackageBuildRoot(){let e=dirname(realpathSync(resolveCurrentModulePath()));for(;;){if(isBuildOutputPackageRoot(e))return e;let t=dirname(e);if(t===e)return null;e=t}}";

const patched =
  "function resolvePackageBuildRoot(){let e=dirname(realpathSync(resolveCurrentModulePath()));for(;;){if(isBuildOutputPackageRoot(e))return e;let t=dirname(e);if(t===e)return resolveInstalledPackageBuildRootFallback();e=t}}" +
  "function resolveInstalledPackageBuildRootFallback(){try{let e=dirname(realpathSync(require.resolve(EVE_PACKAGE_NAME)));for(;;){if(isBuildOutputPackageRoot(e))return e;let t=dirname(e);if(t===e)return null;e=t}}catch{return null}}";

let source;
try {
  source = readFileSync(target, "utf8");
} catch {
  console.log("[patch-eve-dev-host] eve not installed, skipping");
  process.exit(0);
}

if (source.includes("resolveInstalledPackageBuildRootFallback")) {
  console.log("[patch-eve-dev-host] already patched");
} else if (source.includes(original)) {
  writeFileSync(target, source.replace(original, patched));
  console.log("[patch-eve-dev-host] patched", target);
} else {
  console.error(
    "[patch-eve-dev-host] eve's resolvePackageBuildRoot no longer matches — " +
      "eve was likely upgraded. Check whether the dev-host module-map-loader " +
      "crash still reproduces (`eve dev`, send a message); update or delete " +
      "this script accordingly.",
  );
  process.exit(1);
}
