export interface AIKeyRecord {
  id: string;
  label: string;
  apiKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIProviderRecord {
  id: string;
  name: string;
  baseUrl: string | null;
  keys: AIKeyRecord[];
  createdAt: string;
  updatedAt: string;
}
