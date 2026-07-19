import { GOOGLE_CLIENT_ID } from "./config";

/**
 * Browser-only Google auth via Google Identity Services (GIS) token flow.
 * No backend involved: the access token lives in sessionStorage for the tab's
 * lifetime and is used directly against the Drive REST API.
 */

export interface AuthUser {
  name: string;
  email: string;
  picture: string | null;
}

interface AuthSession extends AuthUser {
  token: string;
  exp: number; // epoch ms
}

const STORE_KEY = "plantyj:gauth";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = `${DRIVE_SCOPE} openid email profile`;

/** Whether a space-delimited granted-scope string includes Drive access. */
function hasDriveScope(scope: string | undefined): boolean {
  return !!scope && scope.split(" ").includes(DRIVE_SCOPE);
}

export const AUTH_CHANGED_EVENT = "plantyj:auth-changed";

function notifyAuthChanged(): void {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken: () => void;
}

interface GisOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type?: string }) => void;
  }) => TokenClient;
  revoke?: (token: string, done?: () => void) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GisOAuth2 } };
  }
}

let gisPromise: Promise<GisOAuth2> | null = null;

function loadGis(): Promise<GisOAuth2> {
  const existing = window.google?.accounts?.oauth2;
  if (existing) return Promise.resolve(existing);
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new Error("Google sign-in failed to initialize"));
    };
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function readSession(): AuthSession | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: AuthSession | null): void {
  try {
    if (session) sessionStorage.setItem(STORE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(STORE_KEY);
  } catch {
    // sessionStorage unavailable — auth still works for this page via memory.
  }
  memorySession = session;
}

// Fallback when sessionStorage is blocked.
let memorySession: AuthSession | null = null;

function currentSession(): AuthSession | null {
  return readSession() ?? memorySession;
}

/** Access token if present and not within a minute of expiry. */
export function getAccessToken(): string | null {
  const s = currentSession();
  if (!s || Date.now() > s.exp - 60_000) return null;
  return s.token;
}

/** Who signed in this tab, even if their token has since expired (for UI). */
export function getSessionUser(): AuthUser | null {
  const s = currentSession();
  return s ? { name: s.name, email: s.email, picture: s.picture } : null;
}

interface GrantedToken {
  token: string;
  exp: number;
  scope: string | undefined;
}

function requestToken(prompt: string): Promise<GrantedToken> {
  return loadGis().then(
    (oauth2) =>
      new Promise<GrantedToken>((resolve, reject) => {
        const client = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: SCOPES,
          prompt,
          callback: (resp) => {
            if (resp.error || !resp.access_token) {
              reject(new Error(resp.error ?? "Sign-in was cancelled"));
              return;
            }
            resolve({
              token: resp.access_token,
              exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
              scope: resp.scope,
            });
          },
          error_callback: (err) => reject(new Error(err?.type ?? "Sign-in failed")),
        });
        client.requestAccessToken();
      }),
  );
}

const DRIVE_DENIED_MESSAGE =
  "PlantyJ needs permission to manage its own files in your Google Drive. " +
  "Please check the Google Drive box on the consent screen and try again.";

async function fetchUser(token: string): Promise<AuthUser> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const u = (await res.json()) as { name?: string; email?: string; picture?: string };
      return { name: u.name ?? u.email ?? "Me", email: u.email ?? "", picture: u.picture ?? null };
    }
  } catch {
    // Profile is cosmetic; fall through.
  }
  return { name: "Me", email: "", picture: null };
}

/** Interactive sign-in (must be called from a user gesture). */
export async function signIn(): Promise<AuthUser> {
  let grant = await requestToken("");
  // Granular consent lets the user approve identity but skip the Drive
  // checkbox. If Drive wasn't granted, force the full consent dialog so the
  // box is shown again; if it's still refused, surface a clear reason.
  if (!hasDriveScope(grant.scope)) {
    grant = await requestToken("consent");
    if (!hasDriveScope(grant.scope)) throw new Error(DRIVE_DENIED_MESSAGE);
  }
  const user = await fetchUser(grant.token);
  writeSession({ ...user, token: grant.token, exp: grant.exp });
  notifyAuthChanged();
  return user;
}

/**
 * Attempt to renew the token without user interaction. Returns the new token
 * or null (caller should surface a "sign in again" state).
 */
export async function trySilentRefresh(): Promise<string | null> {
  const prev = currentSession();
  try {
    const { token, exp, scope } = await requestToken("");
    // A silent grant that lost the Drive scope is useless — force the caller
    // back to interactive sign-in rather than caching a broken token.
    if (!hasDriveScope(scope)) return null;
    const user = prev ?? { name: "Me", email: "", picture: null };
    writeSession({ name: user.name, email: user.email, picture: user.picture, token, exp });
    notifyAuthChanged();
    return token;
  } catch {
    return null;
  }
}

export function signOut(): void {
  const s = currentSession();
  writeSession(null);
  if (s?.token) {
    loadGis()
      .then((oauth2) => oauth2.revoke?.(s.token, () => {}))
      .catch(() => {});
  }
  notifyAuthChanged();
}
