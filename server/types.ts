export type ProductUser = {
  id: string;
  name: string;
  initials: string;
};

export type RunRecord = {
  sessionId: string;
  responseId: string;
  userId: string;
  featureKey: string;
  title: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: string;
};

export type StoreData = { runs: RunRecord[] };
