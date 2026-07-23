"use client";

import { SSHPane } from "./registry";
import { useWindowStore } from "@/stores/useWindowStore";
import { useSSHStore } from "@/stores/useSSHStore";

type AgentType = "opencode" | "codex" | "claude";

const AGENT_COMMANDS: Record<AgentType, string> = {
  opencode: "opencode",
  codex: "codex",
  claude: "claude",
};

const AGENT_LABELS: Record<AgentType, string> = {
  opencode: "OpenCode",
  codex: "Codex",
  claude: "Claude",
};

export function CodingAgentPane({
  agent,
  connectionId,
  windowId,
}: {
  agent: AgentType;
  connectionId?: number;
  windowId?: string;
}) {
  const tabId = `coding-agent-${agent}`;
  const sshConnections = useSSHStore((s) => s.connections);

  if (!connectionId && sshConnections.length === 0) {
    return (
      <div className="w-full h-full flex flex-col bg-[#0a0a0a] items-center justify-center p-4">
        <div className="text-center">
          <p className="text-neutral-400 text-sm mb-2">No SSH connections</p>
          <p className="text-neutral-500 text-xs">
            Add an SSH connection first to use coding agents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a]">
      <div className="flex items-center h-9 bg-neutral-950 border-b border-neutral-800 shrink-0 px-3">
        <span className="text-xs text-neutral-400 font-medium">
          {AGENT_LABELS[agent]}
        </span>
      </div>
      <div className="relative flex-1 min-h-0">
        <SSHPane
          tabId={tabId}
          windowId={windowId}
          connectionId={connectionId}
          isActive={true}
          autoCommand={AGENT_COMMANDS[agent]}
        />
      </div>
    </div>
  );
}

export default function CodingAgentWrapper({
  connectionId,
  windowId,
}: {
  connectionId?: number;
  windowId?: string;
}) {
  const win = useWindowStore((s) => s.windows.find((w) => w.id === windowId));
  const agent = (win?.metadata?.agent as AgentType) || "opencode";
  const sshConnections = useSSHStore((s) => s.connections);

  // Use connectionId from metadata, or fallback to first SSH connection
  const effectiveConnectionId = connectionId || (win?.metadata?.connectionId as number) || sshConnections[0]?.id;

  return (
    <CodingAgentPane
      agent={agent}
      connectionId={effectiveConnectionId}
      windowId={windowId}
    />
  );
}
