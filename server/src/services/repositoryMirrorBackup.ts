import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

export interface RepositoryMirrorBackupInput {
  repository: {
    id?: number;
    full_name: string;
    name?: string;
    html_url?: string;
    description?: string | null;
    language?: string | null;
    stargazers_count?: number;
    pushed_at?: string;
  };
  githubToken: string | null;
  webdavConfig: {
    url: string;
    username: string;
    password: string;
    path: string;
  };
}

export interface RepositoryMirrorBackupResult {
  backedUpAt: string;
  mirrorPath: string;
  metadataPath: string;
  size: number;
  format: 'git-bundle';
}

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const MIRROR_TIMEOUT_MS = 30 * 60 * 1000;
const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repository';
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseRepositoryName(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo || !/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error('Invalid GitHub repository full_name');
  }
  return { owner, repo };
}

async function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`${command} timed out`));
        }, options.timeoutMs)
      : null;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      const output = (stderr || stdout).trim();
      reject(new Error(output || `${command} exited with code ${code}`));
    });
  });
}

function getGitEnv(githubToken: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: '0',
  };

  if (githubToken) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: Bearer ${githubToken}`;
  }

  return env;
}

function buildWebDAVFileUrl(
  config: RepositoryMirrorBackupInput['webdavConfig'],
  relativePath: string
): string {
  const baseUrl = config.url.replace(/\/+$/, '');
  const configPath = config.path.startsWith('/') ? config.path : `/${config.path}`;
  const basePath = configPath.endsWith('/') ? configPath : `${configPath}/`;
  return `${baseUrl}${basePath}${relativePath.replace(/^\/+/, '')}`;
}

function getDirectorySegments(configPath: string, relativePath: string): string[] {
  const baseSegments = configPath.split('/').filter(Boolean);
  const relativeSegments = relativePath.replace(/^\/+/, '').split('/').filter(Boolean);
  if (relativeSegments.length > 1) {
    relativeSegments.pop();
  } else {
    relativeSegments.length = 0;
  }
  return [...baseSegments, ...relativeSegments];
}

async function ensureWebDAVDirectories(
  config: RepositoryMirrorBackupInput['webdavConfig'],
  relativePath: string
): Promise<void> {
  const segments = getDirectorySegments(config.path, relativePath);
  if (segments.length === 0) return;

  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  let currentPath = '';
  const baseUrl = config.url.replace(/\/+$/, '');

  for (const segment of segments) {
    currentPath += `/${segment}`;
    const response = await fetch(`${baseUrl}${currentPath}`, {
      method: 'MKCOL',
      headers: {
        'Authorization': `Basic ${credentials}`,
      },
    });

    if (!response.ok && response.status !== 405 && response.status !== 409) {
      throw new Error(`Failed to create WebDAV directory ${currentPath}: HTTP ${response.status}`);
    }
  }
}

async function uploadFileToWebDAV(
  config: RepositoryMirrorBackupInput['webdavConfig'],
  relativePath: string,
  filePath: string,
  contentType: string
): Promise<void> {
  await ensureWebDAVDirectories(config, relativePath);

  const fileStat = await stat(filePath);
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  try {
    const body = Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit;
    const response = await fetch(buildWebDAVFileUrl(config, relativePath), {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': contentType,
        'Content-Length': String(fileStat.size),
      },
      body,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    if (!response.ok) {
      throw new Error(`WebDAV upload failed: HTTP ${response.status} ${response.statusText}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadTextToWebDAV(
  config: RepositoryMirrorBackupInput['webdavConfig'],
  relativePath: string,
  content: string,
  contentType: string
): Promise<void> {
  await ensureWebDAVDirectories(config, relativePath);

  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const response = await fetch(buildWebDAVFileUrl(config, relativePath), {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': contentType,
    },
    body: content,
  });

  if (!response.ok) {
    throw new Error(`WebDAV metadata upload failed: HTTP ${response.status} ${response.statusText}`);
  }
}

export async function backupRepositoryMirror({
  repository,
  githubToken,
  webdavConfig,
}: RepositoryMirrorBackupInput): Promise<RepositoryMirrorBackupResult> {
  const { owner, repo } = parseRepositoryName(repository.full_name);
  const safeOwner = sanitizePathSegment(owner);
  const safeRepo = sanitizePathSegment(repo);
  const timestamp = formatTimestamp(new Date());
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'gsm-mirror-'));

  try {
    const mirrorDirName = `${safeOwner}-${safeRepo}.git`;
    const mirrorDir = path.join(tempRoot, mirrorDirName);
    const bundleFile = path.join(tempRoot, `${safeOwner}-${safeRepo}-mirror-${timestamp}.bundle`);
    const cloneUrl = `https://github.com/${owner}/${repo}.git`;
    const gitEnv = getGitEnv(githubToken);

    await runCommand('git', ['clone', '--mirror', cloneUrl, mirrorDir], {
      env: gitEnv,
      timeoutMs: MIRROR_TIMEOUT_MS,
    });

    await runCommand('git', ['-C', mirrorDir, 'bundle', 'create', bundleFile, '--all'], {
      env: gitEnv,
      timeoutMs: MIRROR_TIMEOUT_MS,
    });

    await runCommand('git', ['-C', mirrorDir, 'bundle', 'verify', bundleFile], {
      env: gitEnv,
      timeoutMs: MIRROR_TIMEOUT_MS,
    });

    const bundleStat = await stat(bundleFile);
    const backedUpAt = new Date().toISOString();
    const directory = `repositories/${safeOwner}/${safeRepo}/git-mirror`;
    const mirrorPath = `${directory}/${safeOwner}-${safeRepo}-mirror-${timestamp}.bundle`;
    const metadataPath = `${directory}/${safeOwner}-${safeRepo}-mirror-${timestamp}.json`;

    await uploadFileToWebDAV(webdavConfig, mirrorPath, bundleFile, 'application/octet-stream');

    const metadata = {
      repository,
      mirror: {
        path: mirrorPath,
        size: bundleStat.size,
        format: 'git-bundle',
        created_at: backedUpAt,
      },
      restore_hint: `git clone ${path.basename(mirrorPath)} ${safeRepo}`,
      version: '1.0',
    };

    await uploadTextToWebDAV(webdavConfig, metadataPath, JSON.stringify(metadata, null, 2), 'application/json');

    return {
      backedUpAt,
      mirrorPath,
      metadataPath,
      size: bundleStat.size,
      format: 'git-bundle',
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
