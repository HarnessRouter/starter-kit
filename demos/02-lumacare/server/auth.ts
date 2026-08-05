import type { Request, Response, NextFunction } from 'express';
import type { ProductUser } from './types.js';

export const DEMO_USERS: Record<string, ProductUser> = {
  alice: { id: 'alice', name: 'Alex Morgan', initials: 'AM' },
  bob: { id: 'bob', name: 'Sam Lee', initials: 'SL' },
};

declare global {
  namespace Express {
    interface Request { productUser: ProductUser }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const userId = String(req.header('x-demo-user') || 'alice');
  const user = DEMO_USERS[userId];
  if (!user) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  req.productUser = user;
  next();
}
