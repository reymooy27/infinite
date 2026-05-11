import type React from "react";

export type AppId = "notes" | "ssh" | "browser" | "devBrowser";

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
}
