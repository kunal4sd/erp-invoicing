import crypto from 'crypto';

export interface JwtPayload {
  sub: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
}

const SECRET = process.env.JWT_SECRET ?? 'demo-jwt-secret-change-in-production';
const TTL_SEC = Number(process.env.JWT_TTL_SEC ?? 86_400);

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signToken(payload: JwtPayload): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({ ...payload, iat: now, exp: now + TTL_SEC }),
  );
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(b64urlDecode(body)) as JwtPayload & { exp?: number };
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return {
    sub: payload.sub,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    tenantId: payload.tenantId,
  };
}
