/**
 * The smallest GitHub client that can commit one file from a phone.
 *
 * Everything goes through the Contents API, which commits exactly one path per
 * call: there is no way to sweep up someone else's unfinished work, which is
 * the "commit by pathspec only" rule enforced by construction.
 *
 * `updateFile` is a read-modify-write with the blob SHA as the lock: GitHub
 * refuses a PUT whose `sha` is not the file's current one, so a concurrent
 * edit cannot be overwritten - the loop re-reads and re-applies instead. A
 * write whose result is byte-identical to what is already there is skipped,
 * which is what makes a half-finished check-in safe to retry.
 */

export interface Repo {
  owner: string;
  repo: string;
  branch: string;
}

export interface FileState {
  text: string;
  sha: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const API = 'https://api.github.com';

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function errorFor(res: Response): Promise<GitHubError> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string };
    if (body && typeof body.message === 'string') detail = body.message;
  } catch {
    /* no JSON body */
  }
  const what =
    res.status === 401
      ? 'GitHub rejected the token'
      : res.status === 403
        ? 'GitHub refused (token lacks permission, or rate limited)'
        : res.status === 404
          ? 'not found (or the token cannot see this repository)'
          : `GitHub returned ${res.status}`;
  return new GitHubError(res.status, detail ? `${what}: ${detail}` : what);
}

function contentsUrl(repo: Repo, path: string): string {
  return `${API}/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${encodeURIComponent(repo.branch)}`;
}

/** Read one file at the branch head. `null` when it does not exist yet. */
export async function getFile(
  fetchFn: FetchLike,
  token: string | null,
  repo: Repo,
  path: string,
): Promise<FileState | null> {
  const res = await fetchFn(contentsUrl(repo, path), {
    headers: headers(token),
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFor(res);
  const body = (await res.json()) as { type?: string; content?: string; sha?: string };
  if (body.type !== 'file' || typeof body.content !== 'string' || typeof body.sha !== 'string') {
    throw new GitHubError(res.status, `${path} is not a file`);
  }
  return { text: decodeBase64(body.content), sha: body.sha };
}

export interface PutResult {
  commitSha: string;
  blobSha: string;
}

export async function putFile(
  fetchFn: FetchLike,
  token: string,
  repo: Repo,
  path: string,
  text: string,
  sha: string | undefined,
  message: string,
): Promise<PutResult> {
  const body: Record<string, string> = {
    message,
    content: encodeBase64(text),
    branch: repo.branch,
  };
  if (sha) body.sha = sha;
  const res = await fetchFn(`${API}/repos/${repo.owner}/${repo.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFor(res);
  const out = (await res.json()) as { commit?: { sha?: string }; content?: { sha?: string } };
  return { commitSha: out.commit?.sha ?? '', blobSha: out.content?.sha ?? '' };
}

export interface UpdateOptions {
  fetch: FetchLike;
  token: string;
  repo: Repo;
  path: string;
  message: string;
  /** Given the current text (null if the file is new), return the text to commit. */
  transform: (current: string | null) => string;
  attempts?: number;
}

export type UpdateResult =
  | { status: 'unchanged'; blobSha: string }
  | { status: 'committed'; commitSha: string; blobSha: string };

/** A stale-SHA rejection: GitHub reports these as 409, and occasionally as 422. */
function isConflict(e: unknown): boolean {
  return e instanceof GitHubError && (e.status === 409 || e.status === 422);
}

export async function updateFile(o: UpdateOptions): Promise<UpdateResult> {
  const attempts = o.attempts ?? 3;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const current = await getFile(o.fetch, o.token, o.repo, o.path);
    const next = o.transform(current ? current.text : null);
    if (current && current.text === next) return { status: 'unchanged', blobSha: current.sha };
    try {
      const r = await putFile(o.fetch, o.token, o.repo, o.path, next, current?.sha, o.message);
      return { status: 'committed', ...r };
    } catch (e) {
      if (!isConflict(e)) throw e;
      lastError = e;
    }
  }
  throw new GitHubError(
    409,
    `the file changed under us ${attempts} times in a row; nothing was lost, try again (${
      lastError instanceof Error ? lastError.message : lastError
    })`,
  );
}

/** Prove a token can see a repository and branch at all, without writing anything. */
export async function checkAccess(
  fetchFn: FetchLike,
  token: string,
  repo: Repo,
): Promise<{ private: boolean }> {
  const res = await fetchFn(`${API}/repos/${repo.owner}/${repo.repo}/branches/${repo.branch}`, {
    headers: headers(token),
    cache: 'no-store',
  });
  if (!res.ok) throw await errorFor(res);
  const meta = await fetchFn(`${API}/repos/${repo.owner}/${repo.repo}`, {
    headers: headers(token),
    cache: 'no-store',
  });
  if (!meta.ok) throw await errorFor(meta);
  const body = (await meta.json()) as { private?: boolean };
  return { private: Boolean(body.private) };
}
