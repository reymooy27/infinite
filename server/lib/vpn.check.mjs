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

console.log("vpn.check: all assertions passed");
