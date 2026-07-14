import { runSSHCommand } from "./ssh.js";
import { logger } from "./logger.js";
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
function cleanLine(line) {
    return line.replace(/\r/g, "").replace(ANSI_PATTERN, "").trimEnd();
}
function parseTable(lines) {
    return lines
        .map(cleanLine)
        .filter((line) => line.includes("\t"))
        .map((line) => line.split("\t").map((c) => c.trim()));
}
function normalizeState(raw) {
    const s = (raw ?? "").toLowerCase();
    if (s.startsWith("up"))
        return "running";
    if (s.startsWith("exited"))
        return "exited";
    if (s.startsWith("paused"))
        return "paused";
    if (s.startsWith("created"))
        return "created";
    if (s.startsWith("restarting"))
        return "restarting";
    if (s.startsWith("dead"))
        return "dead";
    if (s.startsWith("removing"))
        return "removing";
    return "other";
}
export async function listContainers(connection, opts = {}) {
    const filter = opts.all ? "--all" : "";
    const cmd = `docker ps ${filter} --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}\t{{.CreatedAt}}'`;
    const { stdout, code } = await runSSHCommand(connection, cmd);
    if (code !== 0)
        return [];
    const lines = stdout.split("\n").filter((l) => l.trim());
    return parseTable(lines).map((cols) => ({
        id: cols[0] ?? "",
        names: cols[1] ?? "",
        image: cols[2] ?? "",
        status: cols[3] ?? "",
        state: normalizeState(cols[3]),
        ports: cols[5] ?? "",
        created: cols[6] ?? "",
    })).filter((c) => c.id);
}
export async function dockerStats(connection) {
    const cmd = `docker stats --no-stream --format '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}'`;
    const { stdout, code } = await runSSHCommand(connection, cmd);
    if (code !== 0)
        return {};
    const map = {};
    stdout
        .split("\n")
        .map(cleanLine)
        .filter((l) => l.includes("\t"))
        .forEach((line) => {
        const [id, cpuPerc, memUsage] = line.split("\t");
        if (id)
            map[id.trim()] = { cpuPerc: (cpuPerc ?? "").trim(), memUsage: (memUsage ?? "").trim() };
    });
    return map;
}
export async function listImages(connection) {
    const cmd = `docker images --no-trunc --format '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}'`;
    const { stdout, code } = await runSSHCommand(connection, cmd);
    if (code !== 0)
        return [];
    const lines = stdout.split("\n").filter((l) => l.trim());
    return parseTable(lines).map((cols) => ({
        id: cols[0] ?? "",
        repository: !cols[1] || cols[1] === "<none>" ? "" : cols[1],
        tag: !cols[2] || cols[2] === "<none>" ? "" : cols[2],
        size: cols[3] ?? "",
        created: cols[4] ?? "",
    })).filter((i) => i.id);
}
export async function listVolumes(connection) {
    const cmd = `docker volume ls --format '{{.Name}}\t{{.Driver}}\t{{.Size}}'`;
    const { stdout, code } = await runSSHCommand(connection, cmd);
    if (code !== 0)
        return [];
    const lines = stdout.split("\n").filter((l) => l.trim());
    return parseTable(lines).map((cols) => ({
        name: cols[0] ?? "",
        driver: cols[1] ?? "",
        size: cols[2] ?? "",
        created: "",
    })).filter((v) => v.name);
}
export async function listNetworks(connection) {
    const cmd = `docker network ls --no-trunc --format '{{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}'`;
    const { stdout, code } = await runSSHCommand(connection, cmd);
    if (code !== 0)
        return [];
    const lines = stdout.split("\n").filter((l) => l.trim());
    return parseTable(lines).map((cols) => ({
        id: cols[0] ?? "",
        name: cols[1] ?? "",
        driver: cols[2] ?? "",
        scope: cols[3] ?? "",
    })).filter((n) => n.id);
}
async function dockerAction(connection, action, id) {
    const cmd = `docker ${action} ${id}`;
    const { stdout, stderr, code } = await runSSHCommand(connection, cmd);
    if (code !== 0) {
        return { ok: false, message: stderr.trim() || stdout.trim() || `docker ${action} failed` };
    }
    return { ok: true, message: stdout.trim() || `${action} ${id} ok` };
}
export function startContainer(c, id) {
    return dockerAction(c, "start", id);
}
export function stopContainer(c, id) {
    return dockerAction(c, "stop", id);
}
export function restartContainer(c, id) {
    return dockerAction(c, "restart", id);
}
export function pauseContainer(c, id) {
    return dockerAction(c, "pause", id);
}
export function unpauseContainer(c, id) {
    return dockerAction(c, "unpause", id);
}
export function removeContainer(c, id, force = false) {
    return dockerAction(c, force ? "rm -f" : "rm", id);
}
export function removeImage(c, id, force = false) {
    return dockerAction(c, force ? "rmi -f" : "rmi", id);
}
export function removeVolume(c, name, force = false) {
    return dockerAction(c, force ? "volume rm -f" : "volume rm", name);
}
export function removeNetwork(c, id) {
    return dockerAction(c, "network rm", id);
}
export async function inspectContainer(connection, id) {
    const { stdout } = await runSSHCommand(connection, `docker inspect ${id}`);
    return stdout;
}
export async function getContainerLogs(connection, id, opts = {}) {
    const tail = opts.tail ? `--tail ${opts.tail}` : "";
    const since = opts.since ? `--since ${opts.since}` : "";
    const { stdout } = await runSSHCommand(connection, `docker logs ${tail} ${since} ${id}`);
    return stdout;
}
export async function pruneDocker(connection, opts = {}) {
    const cmds = [
        ["containers", "docker container prune -f"],
        ["images", "docker image prune -af"],
        ["networks", "docker network prune -f"],
        ["buildCache", "docker builder prune -af"],
    ];
    if (opts.volumes)
        cmds.push(["volumes", "docker volume prune -f"]);
    const result = {
        containers: "",
        images: "",
        volumes: "",
        networks: "",
        buildCache: "",
    };
    for (const [key, cmd] of cmds) {
        try {
            const { stdout, stderr, code } = await runSSHCommand(connection, cmd);
            result[key] = code === 0 ? stdout.trim() : `Error: ${stderr.trim() || stdout.trim()}`;
        }
        catch (err) {
            result[key] = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
    logger.info("[Docker] Prune completed", { connectionId: connection.id });
    return result;
}
