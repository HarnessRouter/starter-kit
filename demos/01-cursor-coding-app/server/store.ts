import fs from 'node:fs';
import path from 'node:path';
import type { RunRecord, StoreData } from './types.js';

export class OwnershipStore {
  private data: StoreData = { runs: [] };

  constructor(private readonly filePath: string | null = null) {
    if (filePath && fs.existsSync(filePath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoreData;
      } catch {
        this.data = { runs: [] };
      }
    }
  }

  private persist() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  save(record: RunRecord) {
    const index = this.data.runs.findIndex((run) => run.sessionId === record.sessionId);
    if (index >= 0) this.data.runs[index] = { ...this.data.runs[index], ...record };
    else this.data.runs.unshift(record);
    this.persist();
  }

  update(sessionId: string, patch: Partial<RunRecord>) {
    const record = this.data.runs.find((run) => run.sessionId === sessionId);
    if (!record) return;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    this.persist();
  }

  list(userId: string) {
    return this.data.runs.filter((run) => run.userId === userId);
  }

  getAuthorized(sessionId: string, userId: string) {
    const record = this.data.runs.find((run) => run.sessionId === sessionId);
    return record?.userId === userId ? record : null;
  }
}
