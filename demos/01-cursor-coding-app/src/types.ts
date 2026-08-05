export type SessionRecord = {
  sessionId: string;
  responseId: string;
  userId: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentFile = {
  path: string;
  bytes: number;
  media_type: string;
  file_id: string;
};

export type Activity = { id: string; label: string; detail?: string; state: 'active' | 'done' | 'error' };
