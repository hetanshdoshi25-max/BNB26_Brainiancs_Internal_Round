const path = require("node:path");
const { spawnSync } = require("node:child_process");
require("dotenv").config({ path: process.env.ENV_FILE || path.resolve(__dirname, "../../../.env") });

const cli = require.resolve("prisma/build/index.js");
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
