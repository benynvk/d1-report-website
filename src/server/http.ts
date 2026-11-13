import type { Context } from 'hono';
import { ZodError, type ZodType } from 'zod';

/** An error with an HTTP status, rendered as `{ statusCode, message, error }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message);

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
};

/** The error body the web client reads `message` from (string or string[]). */
export function errorResponse(status: number, message: string | string[]): Response {
  return Response.json(
    { statusCode: status, message, error: STATUS_TEXT[status] ?? 'Error' },
    { status },
  );
}

/** Maps anything thrown by a handler to an error response. */
export function toErrorResponse(err: unknown, where: string): Response {
  if (err instanceof HttpError) return errorResponse(err.status, err.message);
  if (err instanceof ZodError) {
    return errorResponse(
      400,
      err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
    );
  }
  console.error(`${where} failed:`, err);
  return errorResponse(500, 'Internal server error');
}

/** Parses + validates a JSON body (unknown keys are stripped by zod). */
export async function body<T>(c: Context, schema: ZodType<T, any, any>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

/** A query-string param, or undefined when absent/empty. */
export function query(c: Context, key: string): string | undefined {
  return c.req.query(key) || undefined;
}

/** JSON for a value; an `undefined`/void result becomes an empty 200. */
export function send(value: unknown): Response {
  return value === undefined ? new Response(null, { status: 200 }) : Response.json(value);
}
