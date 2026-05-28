import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binaryName = process.platform === "win32" ? "roder.exe" : "roder";
const output = resolve(root, "resources", "bin", binaryName);
const sourceDir = resolve(process.env.RODER_SOURCE_DIR ?? resolve(root, "..", "gode"));
const explicit = process.env.RODER_BIN ? resolve(process.env.RODER_BIN) : undefined;

mkdirSync(dirname(output), { recursive: true });

if (explicit) {
  if (!existsSync(explicit)) {
    console.error(`[bundle:roder] RODER_BIN does not exist: ${explicit}`);
    process.exit(1);
  }
  copyFileSync(explicit, output);
  chmodSync(output, 0o755);
  console.log(`[bundle:roder] copied ${explicit} -> ${output}`);
  process.exit(0);
}

if (!existsSync(resolve(sourceDir, "Cargo.toml"))) {
  console.error(`[bundle:roder] no Cargo workspace at ${sourceDir}; set RODER_SOURCE_DIR or RODER_BIN`);
  process.exit(1);
}

console.log(`[bundle:roder] building roder at ${sourceDir}`);
const result = spawnSync("cargo", ["build", "-p", "roder-cli", "--bin", "roder"], {
  cwd: sourceDir,
  stdio: "inherit",
  env: process.env,
});
if (result.status !== 0) process.exit(result.status ?? 1);

const builtBinary = resolve(sourceDir, "target", "debug", binaryName);
copyFileSync(builtBinary, output);
chmodSync(output, 0o755);

if (process.platform === "darwin") {
  const signed = spawnSync("codesign", ["--force", "--sign", "-", output], { stdio: "inherit" });
  if (signed.status !== 0) process.exit(signed.status ?? 1);
}

console.log(`[bundle:roder] wrote ${output}`);
