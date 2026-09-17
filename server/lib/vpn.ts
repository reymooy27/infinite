import { runSSHCommand, type SSHConnection } from "./ssh.js";

// OpenVPN control via the systemd template unit: a profile is
// /etc/openvpn/client/<name>.ovpn on the host and connect/disconnect map to
// `systemctl start|stop openvpn-client@<name>`. Root comes from `sudo -n` with
// a narrow NOPASSWD drop-in (see setupHint); no free-form input ever reaches
// the remote shell — profile names are validated before interpolation.

export interface VpnResult {
  ok: boolean;
  message: string;
  needsSetup?: boolean;
  setupHint?: string;
}

// Safe as a shell argument and (after escaping) as a systemd unit instance.
const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/;

function unitFor(name: string): string {
  return `openvpn-client@${name.replace(/\./g, "%.")}`;
}

export async function listVpnProfiles(connection: SSHConnection): Promise<string[]> {
  const { stdout } = await runSSHCommand(connection, "ls /etc/openvpn/client/*.ovpn 2>/dev/null", { timeoutMs: 10000 });
  const names = stdout
    .split("\n")
    .map((l) => l.trim().replace(/^.*\//, "").replace(/\.ovpn$/, ""))
    .filter((n) => PROFILE_RE.test(n));
  return [...new Set(names)].sort();
}

function setupHint(user: string): string {
  const rule =
    `${user} ALL=(root) NOPASSWD: /usr/b…mctl start openvpn-client@*, ` +
    `/usr/b…mctl stop openvpn-client@*, ` +
    `/usr/b…nctl --no-pager -o cat -n * -u openvpn-client@*`;
  return (
    "Run once on the host:\n" +
    `echo '${rule}' | sudo tee /etc/sudoers.d/infinite-vpn && ` +
    "sudo chmod 440 /etc/sudoers.d/infinite-vpn"
  );
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
  if (/sudo:.*(password|terminal)/i.test(out) || /sudoers/i.test(out)) {
    const { stdout: u } = await runSSHCommand(connection, "id -un", { timeoutMs: 10000 });
    const user = u.trim() || "<user>";
    return {
      ok: false,
      message: `Passwordless sudo is not set up for ${user} on this host.`,
      needsSetup: true,
      setupHint: setupHint(user),
    };
  }
  return { ok: false, message: out || `Failed to ${action} ${name}` };
}

export async function connectVpn(connection: SSHConnection, profile: string): Promise<VpnResult> {
  return toggle(connection, "start", profile);
}

export async function disconnectVpn(connection: SSHConnection, profile?: string): Promise<VpnResult> {
  let name = profile ?? "";
  if (!name) {
    // UI knows the unit only when the openvpn process is visible; discover the
    // running unit instead of guessing.
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
