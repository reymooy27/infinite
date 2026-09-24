import os from "node:os";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { prisma } from "./prisma.js";
import { decrypt, encrypt } from "./crypto.js";
import { runSSHCommand, sftpPutFile, type SSHConnection } from "./ssh.js";

// OpenVPN control via the systemd template unit: a profile mirrors
// /etc/openvpn/client/<name>.ovpn on the host and connect/disconnect maps to
// `systemctl start|stop openvpn-client@<name>`. Profiles uploaded through the
// UI live in the DB (content + optional encrypted credentials) and are
// re-materialized onto the host on every connect, so wiping the host costs
// nothing. Root comes from `sudo -n` with a narrow NOPASSWD drop-in (see
// setupHint); no free-form input ever reaches the remote shell — profile
// names go through the whitelist regex before any interpolation.

export interface VpnResult {
  ok: boolean;
  message: string;
  needsSetup?: boolean;
  setupHint?: string;
  authHint?: boolean;
}

export interface VpnProfileEntry {
  name: string;
  managed: boolean;
  fromDir: boolean;
}

// Safe as single shell argument and (after escaping) systemd unit instance.
const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CONFIG_DIR = "/etc/openvpn/client";
const TMP_PREFIX = "/tmp/.infinite-vpn-";
// Comfortably below the global 100kb express.json() limit.
const MAX_PROFILE_BYTES = 64 * 1024;

// Drop-in folder on the machine running Infinite: every .ovpn here shows up
// in the picker tagged (dir) and is read fresh at connect time.
export const PROFILE_DIR =
  process.env.VPN_PROFILE_DIR || path.join(os.homedir(), ".infinite", "vpn-profiles");

function secret(): string {
  const s = process.env.ENCRYPTION_SECRET;
  if (!s) throw new Error("ENCRYPTION_SECRET not set");
  return s;
}

function unitFor(name: string): string {
  return `openvpn-client@${name.replace(/\./g, "%.")}`;
}

export function slugifyProfile(filename: string): string | null {
  const base = String(filename).replace(/^.*[\\/]/, "").replace(/\.ovpn$/i, "");
  const slug = base.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return slug && PROFILE_RE.test(slug) ? slug : null;
}

// Point the profile's auth-user-pass at our credentials drop-in.
export function ensureAuthLine(content: string, authPath: string): string {
  if (/^[ \t]*auth-user-pass[ \t]+\S/m.test(content)) return content; // explicit path/script already set
  let replaced = false;
  const lines = content.split("\n").map((l) => {
    if (!replaced && /^[ \t]*auth-user-pass[ \t]*$/.test(l)) {
      replaced = true;
      return `auth-user-pass ${authPath}`;
    }
    return l;
  });
  return replaced ? lines.join("\n") : `${content.replace(/\s+$/, "")}\nauth-user-pass ${authPath}\n`;
}

function setupHint(user: string): string {
  const rule =
    `${user} ALL=(root) NOPASSWD: /usr/b…mctl start openvpn-client@*, ` +
    `/usr/b…mctl stop openvpn-client@*, ` +
    `/usr/b…nctl --no-pager -o cat -n * -u openvpn-client@*, ` +
    `/usr/b…nstall -m 600 -o root -g root /tmp/.infinite-vpn-* /etc/openvpn/client/*, ` +
    `/usr/b…m -f /etc/openvpn/client/*.ovpn /etc/openvpn/client/*.auth`;
  return (
    "Run once on the host:\n" +
    `echo '${rule}' | sudo tee /etc/sudoers.d/infinite-vpn && ` +
    "sudo chmod 440 /etc/sudoers.d/infinite-vpn"
  );
}

async function sudoFailure(connection: SSHConnection, out: string): Promise<VpnResult | null> {
  if (!/sudo:.*(password|terminal)/i.test(out) && !/sudoers/i.test(out)) return null;
  const { stdout: u } = await runSSHCommand(connection, "id -un", { timeoutMs: 10000 });
  const user = u.trim() || "<user>";
  return {
    ok: false,
    message: `Passwordless sudo is not set up for ${user} on this host.`,
    needsSetup: true,
    setupHint: setupHint(user),
  };
}

async function listHostProfiles(connection: SSHConnection): Promise<string[]> {
  const { stdout } = await runSSHCommand(connection, `ls ${CONFIG_DIR}/*.ovpn 2>/dev/null`, { timeoutMs: 10000 });
  const names = stdout
    .split("\n")
    .map((l) => l.trim().replace(/^.*\//, "").replace(/\.ovpn$/, ""))
    .filter((n) => PROFILE_RE.test(n));
  return [...new Set(names)];
}

async function listDirProfiles(): Promise<string[]> {
  await mkdir(PROFILE_DIR, { recursive: true }).catch(() => undefined);
  try {
    const files = await readdir(PROFILE_DIR);
    return files
      .filter((f) => f.endsWith(".ovpn"))
      .map((f) => f.slice(0, -".ovpn".length))
      .filter((n) => PROFILE_RE.test(n));
  } catch {
    return [];
  }
}

async function readDirProfile(name: string): Promise<string | null> {
  if (!PROFILE_RE.test(name)) return null;
  try {
    return await readFile(path.join(PROFILE_DIR, `${name}.ovpn`), "utf8");
  } catch {
    return null;
  }
}

export async function listProfiles(connection: SSHConnection): Promise<VpnProfileEntry[]> {
  const [hostNames, rows, dirNames] = await Promise.all([
    listHostProfiles(connection).catch(() => [] as string[]),
    prisma.vpnProfile.findMany({ where: { connectionId: connection.id }, select: { name: true } }),
    listDirProfiles(),
  ]);
  const managed = new Set(rows.map((r) => r.name));
  const inDir = new Set(dirNames);
  return [...new Set([...hostNames, ...managed, ...dirNames])]
    .sort()
    .map((name) => ({ name, managed: managed.has(name), fromDir: !managed.has(name) && inDir.has(name) }));
}

export async function saveProfile(
  connection: SSHConnection,
  filename: string,
  content: string,
): Promise<VpnResult & { name?: string }> {
  const name = slugifyProfile(filename);
  if (!name) return { ok: false, message: "Invalid profile file name" };
  if (typeof content !== "string" || !content.trim()) return { ok: false, message: "Profile file is empty" };
  if (Buffer.byteLength(content) > MAX_PROFILE_BYTES) return { ok: false, message: "Profile exceeds 64KB" };
  const existing = await prisma.vpnProfile.findUnique({
    where: { connectionId_name: { connectionId: connection.id, name } },
    select: { id: true },
  });
  if (!existing && (await listHostProfiles(connection).catch((): string[] => [])).includes(name)) {
    return { ok: false, message: `"${name}" already exists on the host — upload under a different name` };
  }
  await prisma.vpnProfile.upsert({
    where: { connectionId_name: { connectionId: connection.id, name } },
    update: { content },
    create: { connectionId: connection.id, name, content },
  });
  return { ok: true, message: `Saved profile "${name}"`, name };
}

export async function saveProfileAuth(
  connection: SSHConnection,
  name: string,
  username: string,
  password: string,
): Promise<VpnResult> {
  if (!PROFILE_RE.test(name)) return { ok: false, message: "Invalid profile name" };
  const u = String(username || "").trim();
  const p = String(password ?? "");
  if (!u) return { ok: false, message: "Username is required" };
  if (p.includes("\n")) return { ok: false, message: "Password must be a single line" };
  const row = await prisma.vpnProfile.findUnique({
    where: { connectionId_name: { connectionId: connection.id, name } },
    select: { id: true },
  });
  const authEncrypted = encrypt(`${u}\n${p}`, secret());
  if (row) {
    await prisma.vpnProfile.update({ where: { id: row.id }, data: { authEncrypted } });
    return { ok: true, message: `Credentials saved for "${name}"` };
  }
  const dirContent = await readDirProfile(name);
  if (dirContent === null || Buffer.byteLength(dirContent) > MAX_PROFILE_BYTES) {
    return {
      ok: false,
      message: "Credentials can only be attached to profiles uploaded through Infinite or kept in the profiles directory.",
    };
  }
  await prisma.vpnProfile.create({ data: { connectionId: connection.id, name, content: dirContent, authEncrypted } });
  return { ok: true, message: `Credentials saved for "${name}" (stored, from local dir)` };
}

export async function deleteProfile(connection: SSHConnection, name: string): Promise<VpnResult> {
  if (!PROFILE_RE.test(name)) return { ok: false, message: "Invalid profile name" };
  await runSSHCommand(connection, `sudo -n systemctl stop ${unitFor(name)}`, { timeoutMs: 15000 }).catch(() => undefined);
  const { stdout, stderr, code } = await runSSHCommand(
    connection,
    `sudo -n /usr/b… -f ${CONFIG_DIR}/${name}.ovpn ${CONFIG_DIR}/${name}.auth`,
    { timeoutMs: 15000 },
  );
  await prisma.vpnProfile.deleteMany({ where: { connectionId: connection.id, name } });
  if (code !== 0) {
    const out = (stderr || stdout).trim();
    const failure = await sudoFailure(connection, out);
    if (failure) return failure;
    return { ok: true, message: `Removed stored profile; host file kept (${out.slice(0, 200) || "unknown error"})` };
  }
  return { ok: true, message: `Profile "${name}" removed` };
}

// Push the DB-stored profile (and credentials file) onto the host. Returns
// null on success, or the failure to report. Credential bytes move only over
// SFTP into 0600 temp files — never as command arguments, where other users
// could read them from the process table.
async function materialize(connection: SSHConnection, name: string): Promise<VpnResult | null> {
  const row = await prisma.vpnProfile.findUnique({
    where: { connectionId_name: { connectionId: connection.id, name } },
  });
  if (!row) {
    const dirContent = await readDirProfile(name);
    if (dirContent === null) return null; // host-side file, nothing for us to push
    if (Buffer.byteLength(dirContent) > MAX_PROFILE_BYTES) return { ok: false, message: "Profile in local directory exceeds 64KB" };
    if ((await listHostProfiles(connection).catch((): string[] => [])).includes(name)) {
      return { ok: false, message: `"${name}" already exists on the host — rename the local-dir file to push its version` };
    }
    return install(connection, name, dirContent, null);
  }

  const auth = row.authEncrypted ? decrypt(row.authEncrypted, secret()) : null;
  return install(connection, name, row.content, auth);
}

// Push profile (+ optional credentials drop-in) to the host and clean up the
// 0600 SFTP temp files. Credential bytes never travel as command arguments.
// Returns null on success.
async function install(
  connection: SSHConnection,
  name: string,
  rawContent: string,
  auth: string | null,
): Promise<VpnResult | null> {
  const authPath = `${CONFIG_DIR}/${name}.auth`;
  const content = auth ? ensureAuthLine(rawContent, authPath) : rawContent;

  const tmp = TMP_PREFIX + name;
  try {
    await sftpPutFile(connection, `${tmp}.ovpn`, content);
    if (auth) await sftpPutFile(connection, `${tmp}.auth`, auth);
  } catch (err) {
    return { ok: false, message: `Failed to upload profile: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    const cmds = [`sudo -n /usr/b…stall -m 600 -o root -g root ${tmp}.ovpn ${CONFIG_DIR}/${name}.ovpn`];
    if (auth) cmds.push(`sudo -n /usr/b…stall -m 600 -o root -g root ${tmp}.auth ${authPath}`);
    for (const cmd of cmds) {
      const { stdout, stderr, code } = await runSSHCommand(connection, cmd, { timeoutMs: 15000 });
      if (code !== 0) {
        const out = (stderr || stdout).trim();
        const failure = await sudoFailure(connection, out);
        if (failure) return failure;
        return { ok: false, message: out || "Failed to install profile" };
      }
    }
  } finally {
    await runSSHCommand(connection, `/usr/b… -f ${tmp}.ovpn ${tmp}.auth`, { timeoutMs: 10000 }).catch(() => undefined);
  }
  return null;
}

async function toggle(connection: SSHConnection, action: "start" | "stop", name: string): Promise<VpnResult> {
  if (!PROFILE_RE.test(name)) return { ok: false, message: "Invalid profile name" };
  const { stdout, stderr, code } = await runSSHCommand(
    connection,
    `sudo -n systemctl ${action} ${unitFor(name)}`,
    { timeoutMs: action === "start" ? 45000 : 20000 },
  );
  if (code === 0) return { ok: true, message: action === "start" ? `Connecting via ${name}` : `Disconnected (${name})` };
  const out = (stderr || stdout).trim().slice(0, 500);
  const failure = await sudoFailure(connection, out);
  if (failure) return failure;
  return { ok: false, message: out || `Failed to ${action} ${name}` };
}

export async function connectVpn(connection: SSHConnection, profile: string): Promise<VpnResult> {
  if (!PROFILE_RE.test(profile)) return { ok: false, message: "Invalid profile name" };
  const failure = await materialize(connection, profile);
  if (failure) return failure;
  const result = await toggle(connection, "start", profile);
  if (!result.ok && !result.needsSetup) {
    const log = await getVpnLog(connection, profile).catch(() => "");
    if (/AUTH_FAILED|auth failure|certificate verify failed/i.test(log)) result.authHint = true;
  }
  return result;
}

export async function disconnectVpn(connection: SSHConnection, profile?: string): Promise<VpnResult> {
  let name = profile ?? "";
  if (!name) {
    // The UI knows the unit only while the openvpn process is visible;
    // discover the running unit instead of guessing.
    const { stdout } = await runSSHCommand(
      connection,
      "systemctl list-units --type=service --state=running --plain --no-legend 'openvpn-client@*'",
      { timeoutMs: 10000 },
    );
    const unit = stdout.trim().split(/\s+/)[0] || "";
    const m = unit.match(/^openvpn-client@(.+)\.service$/);
    name = m ? m[1].replace(/%\./g, ".") : "";
    if (!name) return { ok: false, message: "No running openvpn-client unit found" };
  }
  return toggle(connection, "stop", name);
}

export async function getVpnLog(connection: SSHConnection, profile?: string): Promise<string> {
  const unit = profile && PROFILE_RE.test(profile) ? unitFor(profile) : "openvpn-client@*";
  const cmd =
    `journalctl --no-pager -o cat -n 25 -u '${unit}' 2>/dev/null || ` +
    `sudo -n journalctl --no-pager -o cat -n 25 -u '${unit}' 2>&1`;
  const { stdout, stderr } = await runSSHCommand(connection, cmd, { timeoutMs: 15000 });
  return (stdout || stderr).trim().slice(-4000) || "(no log lines)";
}
