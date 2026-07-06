"use client";

import { getBrowserId } from "@/lib/browserId";
import { useState, useEffect } from "react";
import { useSSHStore } from "@/stores/useSSHStore";
import { useWindowStore } from "@/stores/useWindowStore";
import type { AuthType } from "@/types";

export default function SSHPanel() {
  const connections = useSSHStore((s) => s.connections);
  const fetchConnections = useSSHStore((s) => s.fetchConnections);
  const createConnection = useSSHStore((s) => s.createConnection);
  const deleteConnection = useSSHStore((s) => s.deleteConnection);
  const loading = useSSHStore((s) => s.loading);
  const error = useSSHStore((s) => s.error);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<AuthType>("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [formError, setFormError] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchConnections();
    fetch("/api/agents").then((r) => r.ok ? r.json() : []).then(setAgents).catch(() => {});
  }, [fetchConnections]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!name.trim() || !host.trim() || !username.trim()) {
      setFormError("Name, host, and username are required");
      return;
    }

    if (authType === "password" && !password.trim()) {
      setFormError("Password is required for password auth");
      return;
    }

    if (authType === "key" && !privateKey.trim()) {
      setFormError("Private key is required for key auth");
      return;
    }

    try {
      await createConnection({
        name: name.trim(),
        host: host.trim(),
        port: parseInt(port, 10) || 22,
        username: username.trim(),
        authType,
        password: authType === "password" ? password : undefined,
        privateKey: authType === "key" ? privateKey : undefined,
        agentId: agentId || undefined,
      });
      setName("");
      setHost("");
      setPort("22");
      setUsername("");
      setAuthType("password");
      setPassword("");
      setPrivateKey("");
      setAgentId("");
      setShowForm(false);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const handleDelete = async (id: number) => {
    await deleteConnection(id);
  };

  const handleConnect = (conn: { id: number; name: string }) => {
    const tabId = getBrowserId("tab-");
    useWindowStore.getState().openApp("ssh", undefined, undefined, {
      connectionId: conn.id,
      title: conn.name,
      tabs: [{ id: tabId, label: "Tab 1", connectionId: conn.id }],
      activeTabId: tabId,
    });
  };

  const handleOpenDevBrowser = (conn: { id: number; name: string }) => {
    useWindowStore.getState().openApp("devBrowser", undefined, undefined, {
      connectionId: conn.id,
      title: `${conn.name} Dev Browser`,
    });
  };

  return (
    <div className="flex flex-col max-h-[70vh] overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {loading && connections.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-neutral-800 animate-pulse" />
            ))}
          </div>
        ) : connections.length === 0 && !showForm ? (
          <div className="text-center py-8 px-4">
            <p className="text-neutral-500 text-sm mb-3">No SSH connections yet</p>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md cursor-pointer transition-colors"
            >
              Add Connection
            </button>
          </div>
        ) : (
          connections.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-2 px-4 py-3 bg-neutral-800 rounded-lg border border-neutral-700"
            >
              <div className="flex-1 min-w-0">
                <div className="text-neutral-200 text-sm font-medium truncate">
                  {conn.name}
                </div>
                <div className="text-xs text-neutral-500 truncate">
                  {conn.username}@{conn.host}:{conn.port}
                </div>
              </div>
              <button
                onClick={() => handleConnect(conn)}
                className="shrink-0 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer transition-colors"
                title="Connect & place on canvas"
              >
                Connect
              </button>
              <button
                onClick={() => handleOpenDevBrowser(conn)}
                className="shrink-0 px-2 py-1 text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-100 rounded cursor-pointer transition-colors"
                title="Open Dev Browser attached to this SSH connection"
              >
                Dev
              </button>
              <button
                onClick={() => handleDelete(conn.id)}
                className="shrink-0 px-1.5 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded cursor-pointer transition-colors"
                title="Delete"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {showForm && (
          <form
          onSubmit={handleSubmit}
          className="border-t border-neutral-700 p-5 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-xs font-semibold text-neutral-300">New Connection</h3>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormError("");
              }}
              className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 px-3 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
          />

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="flex-1 h-8 px-3 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
            />
            <input
              type="number"
              placeholder="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="w-16 h-8 px-2 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500 text-center"
            />
          </div>

          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="h-8 px-3 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
          />

          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer">
              <input
                type="radio"
                name="authType"
                value="password"
                checked={authType === "password"}
                onChange={() => setAuthType("password")}
                className="accent-blue-500"
              />
              Password
            </label>
            <label className="flex items-center gap-1.5 text-xs text-neutral-300 cursor-pointer">
              <input
                type="radio"
                name="authType"
                value="key"
                checked={authType === "key"}
                onChange={() => setAuthType("key")}
                className="accent-blue-500"
              />
              Key
            </label>
          </div>

          {authType === "password" ? (
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-8 px-3 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
            />
          ) : (
            <textarea
              placeholder="Private key"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              rows={3}
              className="px-2 py-1.5 bg-neutral-800 border border-neutral-600 rounded-md text-xs text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500 font-mono resize-none"
            />
          )}

          {agents.length > 0 && (
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="h-8 px-3 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 outline-none focus:border-blue-500"
            >
              <option value="">Via Fly server (public IP)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>Via agent: {a.name}</option>
              ))}
            </select>
          )}

          {formError && <p className="text-red-400 text-xs">{formError}</p>}
          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="h-8 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white text-sm font-medium rounded-md cursor-pointer transition-colors"
          >
            {loading ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      {!showForm && connections.length > 0 && (
        <div className="border-t border-neutral-700 p-4">
          <button
            onClick={() => setShowForm(true)}
            className="w-full h-8 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-300 text-sm rounded-md cursor-pointer transition-colors"
          >
            + Add Connection
          </button>
        </div>
      )}
    </div>
  );
}
