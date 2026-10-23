const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === "path") || "Path";
const environment = {
  ...process.env,
  [pathKey]: `${cargoBin}${path.delimiter}${process.env[pathKey] || ""}`
};
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, ".."),
  env: environment,
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
