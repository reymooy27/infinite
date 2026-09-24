// Runnable self-check for the VPN probe parsing in sysmon.ts.
// Run: node server/lib/vpn.check.mjs   (exits non-zero on failure)
import assert from "node:assert";

// Mirror of parseVpn() — kept in sync by hand (pure, ~20 lines).
function parseVpn(s) {
  const installed = (s.VPN_INSTALLED?.[0] ?? "").trim() === "YES";
  let running = false;
  let connectedSec = 0;
  let profile = null;
  const proc = (s.VPN_PROC ?? []).map((l) => l.trim()).find(Boolean) ?? "";
  const m = proc.match(/^(\d+)\s+(\d+)\s+(.*)$/);
  if (m) {
    running = true;
    connectedSec = Number(m[2]) || 0;
    profile = m[3].match(/([\w.-]+)\.ovpn/)?.[1] ?? null;
  }
  const tun = (s.VPN_TUN?.[0] ?? "").trim().match(/^(\S+)\s+(\d+\.\d+\.\d+\.\d+)/);
  return {
    installed,
    running,
    tunName: tun ? tun[1] : null,
    tunIp: tun ? tun[2] : null,
    connectedSec,
    profile,
  };
}

// 1. Full connected state.
assert.deepStrictEqual(
  parseVpn({
    VPN_INSTALLED: ["YES"],
    VPN_PROC: ["  4211  132 /usr/sbin/openvpn --cd /etc/openvpn/client --config /etc/openvpn/client/proton_nl.ovpn --daemon"],
    VPN_TUN: ["tun0 10.14.0.2/32"],
  }),
  { installed: true, running: true, tunName: "tun0", tunIp: "10.14.0.2", connectedSec: 132, profile: "proton_nl" },
);

// 2. Nothing installed, no process, no tunnel.
assert.deepStrictEqual(
  parseVpn({ VPN_INSTALLED: ["NO"], VPN_PROC: [], VPN_TUN: [] }),
  { installed: false, running: false, tunName: null, tunIp: null, connectedSec: 0, profile: null },
);

// 3. Process up but tunnel not yet assigned ("connecting…").
assert.deepStrictEqual(
  parseVpn({ VPN_INSTALLED: ["YES"], VPN_PROC: ["  99  2 openvpn --config x.ovpn"], VPN_TUN: [] }),
  { installed: true, running: true, tunName: null, tunIp: null, connectedSec: 2, profile: "x" },
);

// 4. Process without a .ovpn arg -> profile unknown.
const noOvpn = parseVpn({ VPN_INSTALLED: ["YES"], VPN_PROC: ["  7  1 openvpn --config /etc/openvpn/client/foo.conf"], VPN_TUN: [] });
assert.strictEqual(noOvpn.running, true);
assert.strictEqual(noOvpn.profile, null);

// 5. Blank ps lines skipped; first real line wins.
const v5 = parseVpn({ VPN_INSTALLED: ["YES"], VPN_PROC: ["", "  55  9 ovpn --config /p/bar-baz.ovpn", "  56  9 stale"], VPN_TUN: [] });
assert.strictEqual(v5.connectedSec, 9);
assert.strictEqual(v5.profile, "bar-baz");

// 6. Missing sections entirely (old host, `ip` absent) -> all null, no throw.
assert.deepStrictEqual(parseVpn({ VPN_INSTALLED: ["NO"] }), {
  installed: false, running: false, tunName: null, tunIp: null, connectedSec: 0, profile: null,
});

// --- slugifyProfile (mirror of vpn.ts) ---
const PROFILE_RE = /^[A-Za-z0-9._-]{1,64}$/;
function slugifyProfile(filename) {
  const base = String(filename).replace(/^.*[\\/]/, "").replace(/\.ovpn$/i, "");
  const slug = base.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
  return slug && PROFILE_RE.test(slug) ? slug : null;
}

assert.strictEqual(slugifyProfile("My VPN 2.ovpn"), "My-VPN-2");
assert.strictEqual(slugifyProfile("/a/b/proton_nl.ovpn"), "proton_nl");
assert.strictEqual(slugifyProfile("we!rd.ovpn"), "werd");
assert.strictEqual(slugifyProfile(".ovpn"), null);
assert.strictEqual(slugifyProfile("x".repeat(65) + ".ovpn"), null);

// --- ensureAuthLine (mirror of vpn.ts) ---
const P = "/etc/openvpn/client/p.auth";
function ensureAuthLine(content, authPath) {
  if (/^[ \t]*auth-user-pass[ \t]+\S/m.test(content)) return content;
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

assert.strictEqual(ensureAuthLine("client\nremote a 1194", P), "client\nremote a 1194\nauth-user-pass /etc/openvpn/client/p.auth\n");
assert.strictEqual(ensureAuthLine("client\nauth-user-pass\nremote a", P), "client\nauth-user-pass /etc/openvpn/client/p.auth\nremote a");
assert.strictEqual(ensureAuthLine("client\nauth-user-pass /custom/x.sh", P), "client\nauth-user-pass /custom/x.sh");
assert.strictEqual(ensureAuthLine("remote a\n\n", P), "remote a\nauth-user-pass /etc/openvpn/client/p.auth\n");

console.log("vpn.check: all assertions passed");
