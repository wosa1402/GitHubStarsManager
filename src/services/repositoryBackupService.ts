import { Repository, WebDAVConfig } from '../types';
import { WebDAVService } from './webdavService';

export interface RepositoryBackupResult {
  archivedAt: string;
  archivePath: string;
  metadataPath: string;
  size: number;
}

interface RepositoryBackupOptions {
  repository: Repository;
  githubToken: string | null;
  webdavConfig: WebDAVConfig;
}

const sanitizePathSegment = (value: string): string => {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'repository';
};

const formatTimestamp = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
};

const parseRepositoryName = (fullName: string): { owner: string; repo: string } => {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error('仓库名称格式无效，无法创建源码备份。');
  }
  return { owner, repo };
};

const buildGitHubArchiveUrl = (owner: string, repo: string): string => {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball`;
};

const explainGitHubArchiveError = async (response: Response): Promise<Error> => {
  let message = '';
  try {
    const data = await response.json() as { message?: string };
    message = data.message ? `: ${data.message}` : '';
  } catch {
    // Ignore non-JSON GitHub error bodies.
  }

  if (response.status === 401) {
    return new Error('GitHub Token 无效或已过期，无法下载源码归档。');
  }
  if (response.status === 403) {
    return new Error(`GitHub 拒绝下载源码归档，可能是权限不足或触发限流${message}`);
  }
  if (response.status === 404) {
    return new Error('仓库当前不可访问，无法从 GitHub 创建源码备份。');
  }
  return new Error(`下载源码归档失败，HTTP状态码 ${response.status}${message}`);
};

export async function backupRepositoryArchive({
  repository,
  githubToken,
  webdavConfig,
}: RepositoryBackupOptions): Promise<RepositoryBackupResult> {
  const { owner, repo } = parseRepositoryName(repository.full_name);
  const headers = new Headers({
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });

  const token = githubToken?.trim();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const archiveResponse = await fetch(buildGitHubArchiveUrl(owner, repo), { headers });
  if (!archiveResponse.ok) {
    throw await explainGitHubArchiveError(archiveResponse);
  }

  const archiveBlob = await archiveResponse.blob();
  if (archiveBlob.size === 0) {
    throw new Error('下载到的源码归档为空，已取消上传。');
  }

  const archivedAt = new Date().toISOString();
  const timestamp = formatTimestamp(new Date(archivedAt));
  const safeOwner = sanitizePathSegment(owner);
  const safeRepo = sanitizePathSegment(repo);
  const directory = `repositories/${safeOwner}/${safeRepo}`;
  const archivePath = `${directory}/${safeOwner}-${safeRepo}-${timestamp}.zip`;
  const metadataPath = `${directory}/${safeOwner}-${safeRepo}-${timestamp}.json`;

  const webdavService = new WebDAVService(webdavConfig);
  await webdavService.uploadBlob(archivePath, archiveBlob, 'application/zip');

  const metadata = {
    repository: {
      id: repository.id,
      name: repository.name,
      full_name: repository.full_name,
      description: repository.description,
      html_url: repository.html_url,
      owner: repository.owner,
      topics: repository.topics,
      language: repository.language,
      stargazers_count: repository.stargazers_count,
      created_at: repository.created_at,
      updated_at: repository.updated_at,
      pushed_at: repository.pushed_at,
      starred_at: repository.starred_at,
    },
    archive: {
      path: archivePath,
      size: archiveBlob.size,
      format: 'zipball',
      created_at: archivedAt,
    },
    version: '1.0',
  };

  await webdavService.uploadFile(metadataPath, JSON.stringify(metadata, null, 2));

  return {
    archivedAt,
    archivePath,
    metadataPath,
    size: archiveBlob.size,
  };
}
