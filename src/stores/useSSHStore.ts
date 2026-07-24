import { create } from "zustand";
import { api } from "@/lib/api";
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
      const data = await api.get<{ connections?: SSHConnection[]; limit?: number; plan?: string }>("/api/connections");
      set({ connections: data.connections ?? (data as unknown as SSHConnection[]), limit: data.limit ?? Infinity, plan: data.plan ?? "local", loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createConnection: async (conn) => {
    set({ loading: true, error: null });
    try {
      const data = await api.post<SSHConnection>("/api/connections", conn);
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
      const data = await api.patch<SSHConnection>(`/api/connections/${id}`, conn);
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
      await api.delete(`/api/connections/${id}`);
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== id),
      }));
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));
