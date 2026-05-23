"use client";

import { useState, useEffect, useCallback } from "react";

interface Agent {
  id: string;
  name: string;
  token: string;
  createdAt: string;
  online?: boolean;
}

export default function AgentPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents");
    if (res.ok) setAgents(await res.json());
  }, []);

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/agents/status");
    if (res.ok) {
      const { online } = await res.json();
      setOnlineIds(new Set(online));
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchAgents, fetchStatus]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      const agent = await res.json();
      setAgents((prev) => [agent, ...prev]);
      setName("");
      setShowForm(false);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    setAgents((prev) => prev.filter((a) => a.id !== id));
  };

  const copyToken = (token: string, id: string) => {
    navigator.clipboard.writeText(token);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "wss://infinite-server.fly.dev";

  return (
    <div className="flex flex-col max-h-[70vh] overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {agents.length === 0 && !showForm ? (
          <div className="text-center py-8 px-4">
            <p className="text-neutral-500 text-sm mb-1">No agents yet</p>
            <p className="text-neutral-600 text-xs mb-4">
              Install an agent on your machine to connect via private/Tailscale IPs
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md cursor-pointer transition-colors"
            >
              Create Agent
            </button>
          </div>
        ) : (
          agents.map((agent) => {
            const isOnline = onlineIds.has(agent.id);
            const installCmd = `INFINITE_TOKEN=${agent.token} INFINITE_SERVER=${wsUrl} npx infinite-agent`;
            return (
              <div key={agent.id} className="flex flex-col gap-2 p-3 bg-neutral-800 rounded-lg border border-neutral-700">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? "bg-green-400" : "bg-neutral-600"}`} />
                    <span className="text-sm font-medium text-neutral-200">{agent.name}</span>
                    <span className={`text-xs ${isOnline ? "text-green-400" : "text-neutral-500"}`}>
                      {isOnline ? "online" : "offline"}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(agent.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded p-1 cursor-pointer transition-colors"
                    title="Delete agent"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
                <div className="text-xs text-neutral-500">Install &amp; run on your machine:</div>
                <div className="flex items-center gap-1.5">
                  <code className="flex-1 text-[10px] bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-neutral-300 font-mono truncate">
                    {installCmd}
                  </code>
                  <button
                    onClick={() => copyToken(installCmd, agent.id)}
                    className="shrink-0 px-2 py-1.5 text-xs bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded cursor-pointer transition-colors"
                  >
                    {copiedId === agent.id ? "✓" : "Copy"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="border-t border-neutral-700 p-4 flex gap-2">
          <input
            autoFocus
            type="text"
            placeholder="Agent name (e.g. Home PC)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 h-8 px-3 bg-neutral-800 border border-neutral-600 rounded-md text-sm text-neutral-200 placeholder-neutral-500 outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="h-8 px-3 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 text-white text-sm rounded-md cursor-pointer transition-colors"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowForm(false)}
            className="h-8 px-2 text-neutral-400 hover:text-neutral-200 cursor-pointer"
          >
            ✕
          </button>
        </form>
      )}

      {!showForm && agents.length > 0 && (
        <div className="border-t border-neutral-700 p-4">
          <button
            onClick={() => setShowForm(true)}
            className="w-full h-8 bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-300 text-sm rounded-md cursor-pointer transition-colors"
          >
            + Create Agent
          </button>
        </div>
      )}
    </div>
  );
}
