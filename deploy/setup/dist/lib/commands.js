import { execa } from "execa";
import { writeFileSync, chmodSync } from "fs";
import { log } from "./logger.js";
import { generateEnvContent } from "./env-writer.js";
import { generateCaddyfile } from "./caddyfile.js";
import { generateServerService, generateFrontendService, generateBotService, } from "./systemd.js";
async function run(cmd, args, opts) {
    log(`$ ${cmd} ${args.join(" ")}`);
    const result = await execa(cmd, args, { ...opts, reject: false });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    if (stdout)
        log(stdout);
    if (stderr)
        log(stderr);
    if (result.exitCode !== 0) {
        throw new Error(stderr || stdout || `Exit code ${result.exitCode}`);
    }
    return stdout;
}
export async function createUser() {
    // Check if user already exists
    try {
        await run("id", ["aebclawd"]);
        log("User aebclawd already exists, skipping");
        return;
    }
    catch {
        // User doesn't exist, create it
    }
    await run("useradd", [
        "--system",
        "--shell", "/bin/bash",
        "--create-home",
        "--home-dir", "/home/aebclawd",
        "aebclawd",
    ]);
    // Grant passwordless sudo
    writeFileSync("/etc/sudoers.d/aebclawd", "aebclawd ALL=(ALL) NOPASSWD: ALL\n");
    chmodSync("/etc/sudoers.d/aebclawd", 0o440);
    log("Created user aebclawd with passwordless sudo");
}
export async function createDirectories(config) {
    await run("mkdir", ["-p", config.workspacesRoot]);
    await run("mkdir", ["-p", config.dataDir]);
    await run("chown", ["-R", "aebclawd:aebclawd", config.workspacesRoot]);
    await run("chown", ["-R", "aebclawd:aebclawd", config.dataDir]);
    await run("chown", ["-R", "aebclawd:aebclawd", config.installDir]);
    log("Created directories and set ownership");
}
export async function writeEnv(config) {
    const envContent = generateEnvContent(config);
    const envPath = `${config.installDir}/.env`;
    writeFileSync(envPath, envContent);
    await run("chown", ["aebclawd:aebclawd", envPath]);
    await run("chmod", ["600", envPath]);
    log(`Wrote .env to ${envPath}`);
}
export async function installCaddy() {
    // Check if already installed
    try {
        await run("caddy", ["version"]);
        log("Caddy already installed, skipping");
        return;
    }
    catch {
        // Not installed, proceed
    }
    await run("apt-get", ["install", "-y", "-qq", "debian-keyring", "debian-archive-keyring", "apt-transport-https", "curl"]);
    // Add Caddy GPG key
    const gpgKey = await execa("curl", ["-1sLf", "https://dl.cloudsmith.io/public/caddy/stable/gpg.key"], { reject: false });
    if (gpgKey.stdout) {
        const dearmor = execa("gpg", ["--dearmor", "-o", "/usr/share/keyrings/caddy-stable-archive-keyring.gpg"], { input: gpgKey.stdout, reject: false });
        await dearmor;
    }
    // Add Caddy apt repo
    const repoList = await execa("curl", ["-1sLf", "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt"], { reject: false });
    if (repoList.stdout) {
        writeFileSync("/etc/apt/sources.list.d/caddy-stable.list", repoList.stdout);
    }
    await run("apt-get", ["update", "-qq"]);
    await run("apt-get", ["install", "-y", "-qq", "caddy"]);
    log("Caddy installed");
}
export async function writeCaddyfile(config) {
    // Hash the password
    const result = await execa("caddy", ["hash-password", "--plaintext", config.basicAuth.password], { reject: false });
    if (result.exitCode !== 0) {
        throw new Error("Failed to hash password: " + result.stderr);
    }
    const hashedPassword = result.stdout.trim();
    const caddyfileContent = generateCaddyfile(config, hashedPassword);
    writeFileSync("/etc/caddy/Caddyfile", caddyfileContent);
    log("Wrote Caddyfile");
}
export async function installDocker() {
    // Check if already installed
    try {
        await run("docker", ["--version"]);
        log("Docker already installed, skipping");
        return;
    }
    catch {
        // Not installed, proceed
    }
    const script = await execa("curl", ["-fsSL", "https://get.docker.com"], { reject: false });
    if (script.stdout) {
        await execa("sh", ["-s"], { input: script.stdout, reject: false });
    }
    await run("usermod", ["-aG", "docker", "aebclawd"]);
    log("Docker installed");
}
export async function installDeps(config) {
    await run("pnpm", ["install"], { cwd: config.installDir });
    log("Dependencies installed");
}
export async function buildFrontend(config) {
    await run("pnpm", ["--filter", "frontend", "build"], { cwd: config.installDir });
    log("Frontend built");
}
export async function buildServer(config) {
    await run("pnpm", ["--filter", "server", "build"], { cwd: config.installDir });
    log("Server built");
}
export async function buildBot(config) {
    await run("pnpm", ["--filter", "bot", "build"], { cwd: config.installDir });
    log("Bot built");
}
export async function installSystemdServices(config) {
    const serviceDir = "/etc/systemd/system";
    writeFileSync(`${serviceDir}/aebclawd-server.service`, generateServerService(config));
    writeFileSync(`${serviceDir}/aebclawd-frontend.service`, generateFrontendService(config));
    const enableList = ["aebclawd-server", "aebclawd-frontend"];
    if (Object.keys(config.bots).length > 0) {
        writeFileSync(`${serviceDir}/aebclawd-bot.service`, generateBotService(config));
        enableList.push("aebclawd-bot");
    }
    await run("systemctl", ["daemon-reload"]);
    await run("systemctl", ["enable", ...enableList]);
    log("Systemd services installed and enabled");
}
export async function configureFirewall() {
    // Check if ufw is available
    try {
        await run("which", ["ufw"]);
    }
    catch {
        await run("apt-get", ["install", "-y", "-qq", "ufw"]);
    }
    await run("ufw", ["allow", "22/tcp"]);
    await run("ufw", ["allow", "80/tcp"]);
    await run("ufw", ["allow", "443/tcp"]);
    await run("ufw", ["--force", "enable"]);
    log("Firewall configured");
}
export async function startVoiceContainers(config) {
    await run("docker", ["compose", "--profile", "cpu", "up", "-d"], {
        cwd: config.installDir,
    });
    log("Voice containers started");
}
export async function startServices(config) {
    const services = ["caddy", "aebclawd-server", "aebclawd-frontend"];
    if (Object.keys(config.bots).length > 0) {
        services.push("aebclawd-bot");
    }
    await run("systemctl", ["restart", ...services]);
    log("All services started");
}
