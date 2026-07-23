// Patches eve@0.25.x for two local/Windows issues. Runs as postinstall so the
// patches survive npm install. Idempotent. Fails loudly if eve's code no
// longer matches (i.e. after an eve upgrade — re-check whether upstream fixed
// each issue, then update or delete the entry).
//
// 1. dev-host session crash:
//      Cannot find module '<project>\src\internal\authored-module-map-loader.ts'
//      imported from <project>\.eve\dev-hosts\<uuid>\nitro\dev\index.mjs
//    The nitro dev-host bundle inlines eve's path resolver. Inside the bundle,
//    resolvePackageBuildRoot() walks up from .eve/dev-hosts/..., never finds a
//    `dist` directory, and falls back to joining the raw `.ts` source path
//    onto the project root. Fix: when the walk-up fails, resolve the installed
//    eve package via require.resolve and walk up from its entry point.
//
// 2. DEP0190 DeprecationWarning on every vercel CLI call (Node 24):
//      Passing args to a child process with shell option true can lead to
//      security vulnerabilities, as the arguments are not escaped, only
//      concatenated.
//    resolveVercelInvocation() on win32 spawns vercel with an args array AND
//    shell:true (shell needed to run the .cmd shim). Fix: build one command
//    string with cmd.exe-style quoting (wrap in double quotes, double inner
//    quotes) and pass an empty args array — same execution, no deprecation,
//    and a local vercel.cmd under a path with spaces now works too.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const eveDist = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules/eve/dist",
);

const PATCHES = [
  {
    name: "dev-host module-map-loader crash",
    file: "src/internal/application/package.js",
    marker: "resolveInstalledPackageBuildRootFallback",
    find: "function resolvePackageBuildRoot(){let e=dirname(realpathSync(resolveCurrentModulePath()));for(;;){if(isBuildOutputPackageRoot(e))return e;let t=dirname(e);if(t===e)return null;e=t}}",
    replace:
      "function resolvePackageBuildRoot(){let e=dirname(realpathSync(resolveCurrentModulePath()));for(;;){if(isBuildOutputPackageRoot(e))return e;let t=dirname(e);if(t===e)return resolveInstalledPackageBuildRootFallback();e=t}}" +
      "function resolveInstalledPackageBuildRootFallback(){try{let e=dirname(realpathSync(require.resolve(EVE_PACKAGE_NAME)));for(;;){if(isBuildOutputPackageRoot(e))return e;let t=dirname(e);if(t===e)return null;e=t}}catch{return null}}",
  },
  {
    name: "DEP0190 vercel spawn warning",
    file: "src/setup/primitives/run-vercel.js",
    marker: "quoteForCmdShell",
    find: "function resolveVercelInvocation(e,t=[],n=process.platform){let r=findLocalVercel(e,n);return n===`win32`?{command:r??`vercel`,commandArgs:t,shell:!0}:r===void 0?{command:`vercel`,commandArgs:t}:{command:r,commandArgs:t}}",
    replace:
      'function quoteForCmdShell(e){return e.length&&!/[\\s"]/.test(e)?e:\'"\'+e.replace(/"/g,\'""\')+\'"\'}' +
      'function resolveVercelInvocation(e,t=[],n=process.platform){let r=findLocalVercel(e,n);if(n===`win32`){let i=[r??`vercel`,...t].map(quoteForCmdShell).join(` `);return{command:i,commandArgs:[],shell:!0}}return r===void 0?{command:`vercel`,commandArgs:t}:{command:r,commandArgs:t}}',
  },
];

let failed = false;

for (const patch of PATCHES) {
  const target = join(eveDist, patch.file);
  let source;
  try {
    source = readFileSync(target, "utf8");
  } catch {
    console.log(`[patch-eve] ${patch.name}: eve not installed, skipping`);
    continue;
  }

  if (source.includes(patch.marker)) {
    console.log(`[patch-eve] ${patch.name}: already patched`);
  } else if (source.includes(patch.find)) {
    writeFileSync(target, source.replace(patch.find, patch.replace));
    console.log(`[patch-eve] ${patch.name}: patched ${patch.file}`);
  } else {
    console.error(
      `[patch-eve] ${patch.name}: code in ${patch.file} no longer matches — ` +
        "eve was likely upgraded. Re-check whether the issue still " +
        "reproduces, then update or delete this patch entry.",
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
