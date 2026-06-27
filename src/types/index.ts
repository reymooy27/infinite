import type React from "react";

export type AppId = "notes" | "ssh" | "devBrowser" | "browserCanvas" | "fileTransfer";

export interface SSHConnection {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
  createdAt: string;
}

export interface WindowData {
  id: string;
  appId: AppId;
  z: number;
  x: number;
  y: number;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
  maximized?: boolean;
  minimized?: boolean;
  prevBounds?: { x: number; y: number; width: number; height: number };
}

export interface AppDefinition {
  id: AppId;
  title: string;
  icon: React.ReactNode;
  component: React.ComponentType<{ connectionId?: number; windowId?: string }>;
  defaultWidth: number;
  defaultHeight: number;
}

export type AuthType = "password" | "key";

export interface CreateConnectionInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authType?: AuthType;
  password?: string;
  privateKey?: string;
  agentId?: string;
}

export interface TerminalTab {
  id: string;
  label: string;
  connectionId?: number;
  title?: string;
  hasNavigated?: boolean;
}

export interface SSHWindowMetadata {
  title?: string;
  autoTitle?: boolean;
  tabs: TerminalTab[];
  activeTabId: string;
}

export function getSSHMetadata(win: WindowData): SSHWindowMetadata | null {
  if (win.appId !== "ssh" || !win.metadata) return null;
  const m = win.metadata;
  if (!Array.isArray(m.tabs)) return null;
  return m as unknown as SSHWindowMetadata;
}

export function normalizeWindow(w: WindowData): WindowData {
  if (w.appId !== "ssh") return w;
  const meta = w.metadata ?? {};
  if (!Array.isArray(meta.tabs)) {
    const tabId = `tab-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return {
      ...w,
      metadata: {
        ...meta,
        tabs: [{ id: tabId, label: "Tab 1", connectionId: meta.connectionId }],
        activeTabId: tabId,
      },
    };
  }
  return w;
}

export interface Project {
  id: string;
  name: string;
  directory?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
