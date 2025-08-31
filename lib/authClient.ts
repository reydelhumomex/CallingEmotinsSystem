export type Role = 'teacher' | 'student';

export interface ClientUser {
  email: string;
  name: string;
  role: Role;
  classId: string;
  token: string;
}

const KEY = 'auth.user';

export function saveUser(u: ClientUser) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(u));
}

export function loadUser(): ClientUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearUser() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
}

