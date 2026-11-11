import { ArgumentsHost, CallHandler, CanActivate, Catch, ExceptionFilter, ExecutionContext, HttpException, Inject, Injectable, Logger, NestInterceptor, createParamDecorator, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Pool } from 'pg';
import { z, ZodTypeAny } from 'zod';
import { ApiError, DB } from '@andum/shared';

export interface AuthUser { id: string; accountId: string; publicKey: string; email: string | null; authMethod: string; sessionAgeSec: number }
export type Req = Request & { user?: AuthUser };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid request', { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}

export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);
/** endpoints a signed-in user without a bound NEAR key may call (binding the key itself, backup, me, logout) */
export const ALLOW_NO_KEY = 'allow_no_key';
export const AllowNoKey = () => SetMetadata(ALLOW_NO_KEY, true);
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<Req>().user!);

export function readCookie(req: Request, name: string): string | null {
  const h = req.headers.cookie; if (!h) return null;
  for (const part of h.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
}
export const SESSION_COOKIE = 'andum_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, @Inject(DB) private db: Pool) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Req>();
    const sid = readCookie(req, SESSION_COOKIE);
    if (!sid || !UUID.test(sid)) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in required');
    const r = await this.db.query(
      `select u.id, u.near_account_id, u.public_key, u.email, s.auth_method, extract(epoch from (now() - s.created_at))::int as age
       from sessions s join users u on u.id=s.user_id where s.id=$1 and s.expires_at > now()`, [sid]);
    if (!r.rowCount) throw new ApiError(401, 'UNAUTHENTICATED', 'Session expired');
    const u = r.rows[0];
    req.user = { id: u.id, accountId: u.near_account_id, publicKey: u.public_key, email: u.email, authMethod: u.auth_method, sessionAgeSec: u.age };
    if (!u.near_account_id && !this.reflector.getAllAndOverride<boolean>(ALLOW_NO_KEY, [ctx.getHandler(), ctx.getClass()])) {
      throw new ApiError(403, 'KEY_REQUIRED', 'Create or restore your wallet key first');
    }
    return true;
  }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('http');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof ApiError) return res.status(e.status).json(e.toBody());
    if (e instanceof HttpException) {
      const s = e.getStatus();
      const code = s === 404 ? 'NOT_FOUND' : s === 401 ? 'UNAUTHENTICATED' : s === 403 ? 'FORBIDDEN' : s === 429 ? 'RATE_LIMITED' : 'VALIDATION_FAILED';
      const resp = e.getResponse();
      const details = resp && typeof resp === 'object' && s === 503 ? (resp as Record<string, unknown>) : {};
      return res.status(s === 503 ? 503 : s).json({ error: { code: s === 503 ? 'UPSTREAM_UNAVAILABLE' : code, message: e.message, details } });
    }
    this.log.error(e instanceof Error ? e.message : String(e)); // never log request bodies or secrets
    return res.status(500).json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Unexpected error', details: {} } });
  }
}

/** Idempotency-Key support for all POSTs except OTP endpoints (ANDUM-PLAN 7.4). */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private db: Pool) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Req>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (req.method !== 'POST' || !key || /\/verify\/(start|confirm)$/.test(req.path)) return next.handle();
    if (key.length > 200) throw new ApiError(400, 'VALIDATION_FAILED', 'Idempotency-Key too long');
    const scope = `${req.user?.id ?? req.ip}:${req.path}`;
    const bodyHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    return from((async () => {
      const ins = await this.db.query(`insert into idempotency_keys (scope, key, body_hash, status) values ($1,$2,$3,0) on conflict do nothing returning 1`, [scope, key, bodyHash]);
      if (ins.rowCount) return { fresh: true as const };
      const ex = (await this.db.query('select body_hash, status, response from idempotency_keys where scope=$1 and key=$2', [scope, key])).rows[0];
      if (ex.body_hash !== bodyHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was used with a different body');
      if (ex.status === 0) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'A request with this key is still in progress');
      return { fresh: false as const, status: ex.status as number, response: ex.response };
    })()).pipe(mergeMap((s) => {
      if (!s.fresh) { res.status(s.status); res.setHeader('Idempotent-Replay', 'true'); return of(s.response); }
      return next.handle().pipe(mergeMap((body) => from((async () => {
        await this.db.query('update idempotency_keys set status=$3, response=$4 where scope=$1 and key=$2', [scope, key, res.statusCode, JSON.stringify(body ?? null)]);
        return body;
      })())));
    }));
  }
}
export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';
