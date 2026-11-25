// Copies the version in package.json (the single source of the app version) to the Rust crate:
// src-tauri/Cargo.toml and the hex_ff entry in Cargo.lock. tauri.conf.json reads the version from
// package.json directly. Runs automatically from the npm "version" lifecycle script, so
// `npm version patch|minor|major` bumps every version at once; it can also be run on its own.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Semantic Versioning 2.0.0, https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
if (!semver.test(version)) {
    console.error(`package.json version "${version}" is not a semantic version`);
    process.exit(1);
}

const replaceOnce = (file, pattern, replacement) => {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    if (!pattern.test(text)) {
        console.error(`Version entry not found in ${file}`);
        process.exit(1);
    }
    writeFileSync(path, text.replace(pattern, replacement));
};

replaceOnce("src-tauri/Cargo.toml", /^(\[package\][^[]*?^version = )"[^"]*"/m, `$1"${version}"`);
replaceOnce("Cargo.lock", /^(name = "hex_ff"\r?\nversion = )"[^"]*"/m, `$1"${version}"`);

console.log(`Version ${version} written to src-tauri/Cargo.toml and Cargo.lock`);
