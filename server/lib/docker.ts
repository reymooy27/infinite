import { runSSHCommand, type SSHConnection } from "./ssh.js";
import { logger } from "./logger.js";

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: "running" | "exited" | "paused" | "created" | "restarting" | "dead" | "removing" | "other";
  ports: string;
  created: string;
  cpuPerc?: string;
  memUsage?: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  size: string;
  created: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerPruneResult {
  containers: string;
  images: string;
  volumes: string;
  networks: string;
  buildCache: string;
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function cleanLine(line: string): string {
  return line.replace(/\r/g, "").replace(ANSI_PATTERN, "").trimEnd();
}

function parseTable(lines: string[]): string[][] {
  return lines
    .map(cleanLine)
    .filter((line) => line.includes("\t"))
    .map((line) => line.split("\t").map((c) => c.trim()));
}

function normalizeState(raw: string | undefined): DockerContainer["state"] {
  const s = (raw ?? "").toLowerCase();
  if (s.startsWith("up")) return "running";
  if (s.startsWith("exited")) return "exited";
  if (s.startsWith("paused")) return "paused";
  if (s.startsWith("created")) return "created";
  if (s.startsWith("restarting")) return "restarting";
  if (s.startsWith("dead")) return "dead";
  if (s.startsWith("removing")) return "removing";
  return "other";
}

export async function listContainers(
  connection: SSHConnection,
  opts: { all?: boolean } = {},
): Promise<DockerContainer[]> {
  const filter = opts.all ? "--all" : "";
  const cmd = `docker ps ${filter} --no-trunc --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}\t{{.Ports}}\t{{.CreatedAt}}'`;
  const { stdout, code } = await runSSHCommand(connection, cmd);
  if (code !== 0) return [];
  const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
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

export async function dockerStats(
  connection: SSHConnection,
): Promise<Record<string, { cpuPerc: string; memUsage: string }>> {
  const cmd = `docker stats --no-stream --format '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}'`;
  const { stdout, code } = await runSSHCommand(connection, cmd);
  if (code !== 0) return {};
  const map: Record<string, { cpuPerc: string; memUsage: string }> = {};
  stdout
    .split("\n")
    .map(cleanLine)
    .filter((l) => l.includes("\t"))
    .forEach((line) => {
      const [id, cpuPerc, memUsage] = line.split("\t");
      if (id) map[id.trim()] = { cpuPerc: (cpuPerc ?? "").trim(), memUsage: (memUsage ?? "").trim() };
    });
  return map;
}

export async function listImages(connection: SSHConnection): Promise<DockerImage[]> {
  const cmd = `docker images --no-trunc --format 'table {{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}'`;
  const { stdout, code } = await runSSHCommand(connection, cmd);
  if (code !== 0) return [];
  const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
  return parseTable(lines).map((cols) => ({
    id: cols[0] ?? "",
    repository: !cols[1] || cols[1] === "<none>" ? "" : cols[1],
    tag: !cols[2] || cols[2] === "<none>" ? "" : cols[2],
    size: cols[3] ?? "",
    created: cols[4] ?? "",
  })).filter((i) => i.id);
}

export async function listVolumes(connection: SSHConnection): Promise<DockerVolume[]> {
  const cmd = `docker volume ls --format 'table {{.Name}}\t{{.Driver}}\t{{.Size}}'`;
  const { stdout, code } = await runSSHCommand(connection, cmd);
  if (code !== 0) return [];
  const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
  return parseTable(lines).map((cols) => ({
    name: cols[0] ?? "",
    driver: cols[1] ?? "",
    size: cols[2] ?? "",
    created: "",
  })).filter((v) => v.name);
}

export async function listNetworks(connection: SSHConnection): Promise<DockerNetwork[]> {
  const cmd = `docker network ls --no-trunc --format 'table {{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}'`;
  const { stdout, code } = await runSSHCommand(connection, cmd);
  if (code !== 0) return [];
  const lines = stdout.split("\n").slice(1).filter((l) => l.trim());
  return parseTable(lines).map((cols) => ({
    id: cols[0] ?? "",
    name: cols[1] ?? "",
    driver: cols[2] ?? "",
    scope: cols[3] ?? "",
  })).filter((n) => n.id);
}

async function dockerAction(
  connection: SSHConnection,
  action: string,
  id: string,
): Promise<{ ok: boolean; message: string }> {
  const cmd = `docker ${action} ${id}`;
  const { stdout, stderr, code } = await runSSHCommand(connection, cmd);
  if (code !== 0) {
    return { ok: false, message: stderr.trim() || stdout.trim() || `docker ${action} failed` };
  }
  return { ok: true, message: stdout.trim() || `${action} ${id} ok` };
}

export function startContainer(c: SSHConnection, id: string) {
  return dockerAction(c, "start", id);
}
export function stopContainer(c: SSHConnection, id: string) {
  return dockerAction(c, "stop", id);
}
export function restartContainer(c: SSHConnection, id: string) {
  return dockerAction(c, "restart", id);
}
export function pauseContainer(c: SSHConnection, id: string) {
  return dockerAction(c, "pause", id);
}
export function unpauseContainer(c: SSHConnection, id: string) {
  return dockerAction(c, "unpause", id);
}
export function removeContainer(c: SSHConnection, id: string, force = false) {
  return dockerAction(c, force ? "rm -f" : "rm", id);
}
export function removeImage(c: SSHConnection, id: string, force = false) {
  return dockerAction(c, force ? "rmi -f" : "rmi", id);
}
export function removeVolume(c: SSHConnection, name: string, force = false) {
  return dockerAction(c, force ? "volume rm -f" : "volume rm", name);
}
export function removeNetwork(c: SSHConnection, id: string) {
  return dockerAction(c, "network rm", id);
}

export async function inspectContainer(
  connection: SSHConnection,
  id: string,
): Promise<string> {
  const { stdout } = await runSSHCommand(connection, `docker inspect ${id}`);
  return stdout;
}

export async function getContainerLogs(
  connection: SSHConnection,
  id: string,
  opts: { tail?: number; since?: string } = {},
): Promise<string> {
  const tail = opts.tail ? `--tail ${opts.tail}` : "";
  const since = opts.since ? `--since ${opts.since}` : "";
  const { stdout } = await runSSHCommand(
    connection,
    `docker logs ${tail} ${since} ${id}`,
  );
  return stdout;
}

export async function pruneDocker(
  connection: SSHConnection,
  opts: { volumes?: boolean } = {},
): Promise<DockerPruneResult> {
  const cmds: Array<[keyof DockerPruneResult, string]> = [
    ["containers", "docker container prune -f"],
    ["images", "docker image prune -af"],
    ["networks", "docker network prune -f"],
    ["buildCache", "docker builder prune -af"],
  ];
  if (opts.volumes) cmds.push(["volumes", "docker volume prune -f"]);

  const result: DockerPruneResult = {
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
    } catch (err) {
      result[key] = `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  logger.info("[Docker] Prune completed", { connectionId: connection.id });
  return result;
}
