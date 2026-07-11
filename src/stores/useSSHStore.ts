import { create } from "zustand";
import type { SSHConnection, CreateConnectionInput } from "@/types";

interface SSHState {
  connections: SSHConnection[];
  limit: number;
  plan: string;
  loading: boolean;
  error: string | null;
  fetchConnections: () => Promise<void>;
  createConnection: (conn: CreateConnectionInput) => Promise<SSHConnection>;
  updateConnection: (id: number, conn: CreateConnectionInput) => Promise<SSHConnection>;
  deleteConnection: (id: number) => Promise<void>;
}

export const useSSHStore = create<SSHState>((set) => ({
  connections: [],
  limit: Infinity,
  plan: "local",
  loading: false,
  error: null,

  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/connections");
      if (!res.ok) throw new Error("Failed to fetch connections");
      const data = await res.json();
      set({ connections: data.connections ?? data, limit: Infinity, plan: "local", loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createConnection: async (conn) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conn),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to create connection" }));
        throw new Error(err.error);
      }
      const data = await res.json();
      set((state) => ({
        connections: [data, ...state.connections],
        loading: false,
      }));
      return data;
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  updateConnection: async (id, conn) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conn),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to update connection" }));
        throw new Error(err.error);
      }
      const data = await res.json();
      set((state) => ({
        connections: state.connections.map((connection) =>
          connection.id === id ? data : connection
        ),
        loading: false,
      }));
      return data;
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
      throw err;
    }
  },

  deleteConnection: async (id) => {
    try {
      await fetch(`/api/connections/${id}`, { method: "DELETE" });
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== id),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));
