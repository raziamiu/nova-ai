import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

/**
 * Nova never calls `ctx.getSandbox()` and has no seeded workspace files — its
 * tools talk to `StoreClient` (demo or live Dakio) directly, never the shell.
 * The framework still warms one sandbox template at boot for its default
 * bash/read_file/write_file/glob/grep tools, and on this Windows dev box the
 * auto-detected Docker backend hangs indefinitely during that warm-up (a
 * Docker-CLI-via-child-process issue, not a Nova bug — Docker itself is
 * healthy; `docker ps`/`docker run` work fine outside eve).
 *
 * Pin the dependency-free `justbash()` backend so startup never touches
 * Docker. No real binaries or network isolation, which is fine: Nova doesn't
 * exercise the sandbox at all.
 */
export default defineSandbox({
  backend: justbash(),
});
