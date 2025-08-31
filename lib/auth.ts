import type { NextApiRequest } from 'next';

export type Role = 'teacher' | 'student';

export interface MockUser {
  role: Role;
  name: string;
  classId: string;
}

export interface AuthedUser extends MockUser {
  email: string;
  token: string;
}

// Mock users for demo
export const mockUsers: Record<string, MockUser> = {
  'teacher@math101': { role: 'teacher', name: 'Professor Smith', classId: 'math101' },
  'student1@math101': { role: 'student', name: 'Alice Johnson', classId: 'math101' },
  'student2@math101': { role: 'student', name: 'Bob Wilson', classId: 'math101' },
  'student3@math101': { role: 'student', name: 'Carol Davis', classId: 'math101' },
  'student4@math101': { role: 'student', name: 'David Brown', classId: 'math101' },
};

const sessions = new Map<string, AuthedUser>();

export function createToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID();
  }
  // Fallback
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function login(email: string, classId: string): AuthedUser | null {
  const base = mockUsers[email];
  if (!base) return null;
  if (base.classId !== classId) return null;
  const token = createToken();
  const user: AuthedUser = { ...base, email, token };
  sessions.set(token, user);
  return user;
}

export function getUserByToken(token?: string | null): AuthedUser | null {
  if (!token) return null;
  return sessions.get(token) || null;
}

export function getUserFromRequest(req: NextApiRequest): AuthedUser | null {
  const auth = req.headers['authorization'];
  let token: string | undefined;
  if (auth) {
    const [type, value] = String(auth).split(' ');
    if (type === 'Bearer' && value) token = value;
  }
  // Primary: lookup by session token
  const byToken = getUserByToken(token);
  if (byToken) return byToken;
  // Fallback for demo robustness: accept explicit user email header
  const email = (req.headers['x-user-email'] as string) || '';
  if (email && mockUsers[email]) {
    const base = mockUsers[email];
    return { ...base, email, token: token || `mock-${email}` };
  }
  return null;
}

export function listMockUsers(): Array<{ email: string; role: Role; name: string; classId: string }> {
  return Object.entries(mockUsers).map(([email, u]) => ({ email, ...u }));
}
