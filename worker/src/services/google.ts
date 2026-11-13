import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config';
import { badRequest } from '../http';

/**
 * The few Google auth calls the app needs, over plain fetch + WebCrypto
 * (google-auth-library depends on Node APIs Workers don't have).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
// Google Chat signs its webhook calls as this service account.
const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const chatKeys = createRemoteJWKSet(
  new URL(`https://www.googleapis.com/service_accounts/v1/jwk/${CHAT_ISSUER}`),
);

function clientCredentials() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw badRequest('Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID/SECRET)');
  }
  return { client_id: config.googleClientId, client_secret: config.googleClientSecret };
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...clientCredentials(), ...params }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn(`Google token endpoint ${res.status}: ${JSON.stringify(data)}`);
    throw badRequest(
      data.error === 'invalid_grant'
        ? 'Google access was revoked or expired - reconnect Google Sheets on the WIP page.'
        : `Google OAuth error (${data.error ?? res.status})`,
    );
  }
  return data;
}

/** The consent-screen URL that starts the OAuth flow. */
export function authUrl(redirectUri: string, scopes: string[]): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientCredentials().client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent', // ensures a refresh_token is issued every time
    scope: scopes.join(' '),
  }).toString();
  return url.toString();
}

/** Exchanges an OAuth code for a refresh token (+ the account's email). */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string | null; email: string | null }> {
  const data = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  let email: string | null = null;
  if (data.id_token) {
    const { payload } = await jwtVerify(data.id_token, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: config.googleClientId,
    });
    email = typeof payload.email === 'string' ? payload.email : null;
  }
  return { refreshToken: data.refresh_token ?? null, email };
}

// Access tokens live ~1h; reuse one within this isolate.
let cached: { refreshToken: string; accessToken: string; expiresAt: number } | null = null;

export async function accessTokenFor(refreshToken: string): Promise<string> {
  if (cached?.refreshToken === refreshToken && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }
  const data = await tokenRequest({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (!data.access_token) throw badRequest('Could not obtain a Google access token');
  cached = {
    refreshToken,
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return cached.accessToken;
}

/** Verifies the JWT Google Chat attaches to a webhook call. Throws if invalid. */
export async function verifyChatToken(token: string, audience: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, chatKeys, { issuer: CHAT_ISSUER, audience });
  return payload;
}
