import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role, UserDTO, WorkspaceDTO } from '@vidimus/shared';
import type { Db } from '../db/database.js';
import { sha256Hex } from '../security/crypto.js';

export const SESSION_COOKIE = 'vidimus_session';

export interface AuthContext {
  user: UserDTO;
  sessionId: string;
  csrfToken: string;
  workspaces: WorkspaceDTO[];
  activeWorkspace: WorkspaceDTO;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function loadAuthContext(db: Db, rawToken: string | undefined, requestedWorkspaceId?: string): AuthContext | null {
  if (!rawToken) return null;
  const tokenHash = sha256Hex(rawToken);
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf_token, s.expires_at,
              u.id, u.email, u.name, u.title, u.role, u.avatar_index
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, now) as
    | {
        session_id: string;
        csrf_token: string;
        expires_at: string;
        id: string;
        email: string;
        name: string;
        title: string;
        role: Role;
        avatar_index: number;
      }
    | undefined;

  if (!row) return null;

  const wsRows = db
    .prepare(
      `SELECT w.id, w.slug, w.name, m.role
       FROM workspace_memberships m
       JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY w.created_at ASC`
    )
    .all(row.id) as Array<{ id: string; slug: string; name: string; role: Role }>;

  if (!wsRows.length) return null;

  const active =
    (requestedWorkspaceId ? wsRows.find((w) => w.id === requestedWorkspaceId) : null) || wsRows[0];

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      title: row.title,
      role: row.role,
      avatarIndex: row.avatar_index,
    },
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    workspaces: wsRows,
    activeWorkspace: active,
  };
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): AuthContext | null {
  if (!req.auth) {
    reply.code(401).send({ error: 'Authentication required' });
    return null;
  }
  return req.auth;
}

export function requireRole(
  req: FastifyRequest,
  reply: FastifyReply,
  allowed: Role[]
): AuthContext | null {
  const auth = requireAuth(req, reply);
  if (!auth) return null;
  if (!allowed.includes(auth.activeWorkspace.role) && !allowed.includes(auth.user.role)) {
    reply.code(403).send({ error: 'Insufficient permissions for this action' });
    return null;
  }
  return auth;
}

export function verifyCsrf(req: FastifyRequest, reply: FastifyReply): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  // Login & register establish a new session and are exempt from pre-existing CSRF token
  const url = req.url.split('?')[0];
  if (url === '/api/auth/login' || url === '/api/auth/register') return true;
  if (!req.auth) return true; // requireAuth will reject with 401
  const header = req.headers['x-csrf-token'];
  if (typeof header !== 'string' || header !== req.auth.csrfToken) {
    reply.code(403).send({ error: 'Invalid or missing CSRF token' });
    return false;
  }
  return true;
}
