import { create } from "zustand";

const API_URL = `http://${window.location.hostname}:3001/api/connections`;

const useSSHStore = create((set) => ({
  connections: [],
  loading: false,
  error: null,

  fetchConnections: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error("Failed to fetch connections");
      const data = await res.json();
      set({ connections: data, loading: false });
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  createConnection: async (conn) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conn),
      });
      if (!res.ok) throw new Error("Failed to create connection");
      const data = await res.json();
      set((state) => ({
        connections: [data, ...state.connections],
        loading: false,
      }));
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteConnection: async (id) => {
    try {
      await fetch(`${API_URL}/${id}`, { method: "DELETE" });
      set((state) => ({
        connections: state.connections.filter((c) => c.id !== id),
      }));
    } catch (err) {
      set({ error: err.message });
    }
  },
}));

export default useSSHStore;