import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { decrypt } from '../services/crypto.js';
import { backupRepositoryMirror } from '../services/repositoryMirrorBackup.js';

const router = Router();

// Helper to parse JSON columns safely
function parseJsonColumn(value: unknown): unknown[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

// Helper to transform DB row to API response
function transformRepo(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    full_name: row.full_name,
    description: row.description,
    html_url: row.html_url,
    stargazers_count: row.stargazers_count,
    language: row.language,
    created_at: row.created_at,
    updated_at: row.updated_at,
    pushed_at: row.pushed_at,
    starred_at: row.starred_at,
    star_sources: parseJsonColumn(row.star_sources),
    owner: { login: row.owner_login, avatar_url: row.owner_avatar_url },
    topics: parseJsonColumn(row.topics),
    ai_summary: row.ai_summary,
    ai_tags: parseJsonColumn(row.ai_tags),
    ai_platforms: parseJsonColumn(row.ai_platforms),
    analyzed_at: row.analyzed_at,
    analysis_failed: !!row.analysis_failed,
    custom_description: row.custom_description,
    custom_tags: parseJsonColumn(row.custom_tags),
    custom_category: row.custom_category,
    category_locked: !!row.category_locked,
    last_edited: row.last_edited,
    subscribed_to_releases: !!row.subscribed_to_releases,
    archive_backed_up_at: row.archive_backed_up_at ?? undefined,
    archive_backup_path: row.archive_backup_path ?? undefined,
    archive_backup_size: row.archive_backup_size ?? undefined,
    mirror_backed_up_at: row.mirror_backed_up_at ?? undefined,
    mirror_backup_path: row.mirror_backup_path ?? undefined,
    mirror_backup_size: row.mirror_backup_size ?? undefined,
  };
}

// GET /api/repositories
router.get('/api/repositories', (req, res) => {
  try {
    const db = getDb();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(10000, Math.max(1, parseInt(req.query.limit as string) || 100));
    const search = req.query.search as string | undefined;
    const offset = (page - 1) * limit;

    let sql = 'SELECT * FROM repositories';
    const params: unknown[] = [];

    if (search) {
      const escaped = search.replace(/[%_\\]/g, '\\$&');
      sql += " WHERE name LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR ai_summary LIKE ? ESCAPE '\\' OR ai_tags LIKE ? ESCAPE '\\'";
      const searchPattern = `%${escaped}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    sql += ' ORDER BY stargazers_count DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    const repositories = rows.map(transformRepo);

    const countSql = search
      ? 'SELECT COUNT(*) as total FROM repositories WHERE name LIKE ? OR full_name LIKE ? OR description LIKE ? OR ai_summary LIKE ? OR ai_tags LIKE ?'
      : 'SELECT COUNT(*) as total FROM repositories';
    const countParams = search ? Array(5).fill(`%${search}%`) : [];
    const countRow = db.prepare(countSql).get(...countParams) as { total: number };

    res.json({ repositories, total: countRow.total, page, limit });
  } catch (err) {
    console.error('GET /api/repositories error:', err);
    res.status(500).json({ error: 'Failed to fetch repositories', code: 'FETCH_REPOSITORIES_FAILED' });
  }
});

// PUT /api/repositories (bulk upsert)
router.put('/api/repositories', (req, res) => {
  try {
    const db = getDb();
    const { repositories } = req.body as { repositories: Record<string, unknown>[] };
    if (!Array.isArray(repositories)) {
      res.status(400).json({ error: 'repositories array required', code: 'REPOSITORIES_ARRAY_REQUIRED' });
      return;
    }

    // 验证每个仓库的ID
    for (const repo of repositories) {
      if (!repo.id || typeof repo.id !== 'number' || repo.id <= 0) {
        res.status(400).json({ error: 'Each repository must have a valid positive integer id', code: 'INVALID_REPOSITORY_ID' });
        return;
      }
      if (!repo.full_name || typeof repo.full_name !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid full_name', code: 'INVALID_REPOSITORY_FULL_NAME' });
        return;
      }
      if (!repo.name || typeof repo.name !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid name', code: 'INVALID_REPOSITORY_NAME' });
        return;
      }
      const owner = repo.owner as Record<string, unknown> | undefined;
      if (!owner || typeof owner.login !== 'string' || typeof owner.avatar_url !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid owner with login and avatar_url', code: 'INVALID_REPOSITORY_OWNER' });
        return;
      }
      if (!repo.html_url || typeof repo.html_url !== 'string') {
        res.status(400).json({ error: 'Each repository must have a valid html_url', code: 'INVALID_REPOSITORY_HTML_URL' });
        return;
      }
      if (typeof repo.stargazers_count !== 'number' || repo.stargazers_count < 0) {
        res.status(400).json({ error: 'Each repository must have a valid non-negative stargazers_count', code: 'INVALID_STARGAZERS_COUNT' });
        return;
      }
    }

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO repositories (
        id, name, full_name, description, html_url, stargazers_count, language,
        created_at, updated_at, pushed_at, starred_at, star_sources,
        owner_login, owner_avatar_url, topics,
        ai_summary, ai_tags, ai_platforms, analyzed_at, analysis_failed,
        custom_description, custom_tags, custom_category, category_locked, last_edited,
        subscribed_to_releases, archive_backed_up_at, archive_backup_path, archive_backup_size,
        mirror_backed_up_at, mirror_backup_path, mirror_backup_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteAllReleases = db.prepare('DELETE FROM releases');
    const deleteAllRepositories = db.prepare('DELETE FROM repositories');
    const deleteReleasesNotIn = (placeholders: string) =>
      db.prepare(`DELETE FROM releases WHERE repo_id NOT IN (${placeholders})`);
    const deleteRepositoriesNotIn = (placeholders: string) =>
      db.prepare(`DELETE FROM repositories WHERE id NOT IN (${placeholders})`);

    const upsert = db.transaction(() => {
      const isFullSync = Boolean(req.body?.isFullSync);

      if (isFullSync) {
        const repoIds = repositories
          .map((repo) => repo.id)
          .filter((id): id is number => typeof id === 'number');

        if (repoIds.length === 0) {
          deleteAllReleases.run();
          deleteAllRepositories.run();
          return 0;
        }

        const placeholders = repoIds.map(() => '?').join(', ');
        deleteReleasesNotIn(placeholders).run(...repoIds);
        deleteRepositoriesNotIn(placeholders).run(...repoIds);
      }

      let count = 0;
      for (const repo of repositories) {
        const owner = repo.owner as { login?: string; avatar_url?: string } | undefined;
        stmt.run(
          repo.id, repo.name, repo.full_name, repo.description ?? null,
          repo.html_url, repo.stargazers_count ?? 0, repo.language ?? null,
          repo.created_at ?? null, repo.updated_at ?? null, repo.pushed_at ?? null,
          repo.starred_at ?? null,
          JSON.stringify(Array.isArray(repo.star_sources) ? repo.star_sources : []),
          owner?.login ?? '', owner?.avatar_url ?? null,
          JSON.stringify(Array.isArray(repo.topics) ? repo.topics : []),
          repo.ai_summary ?? null,
          JSON.stringify(Array.isArray(repo.ai_tags) ? repo.ai_tags : []),
          JSON.stringify(Array.isArray(repo.ai_platforms) ? repo.ai_platforms : []),
          repo.analyzed_at ?? null, (repo.analysis_failed === true || repo.analysis_failed === 1) ? 1 : 0,
          repo.custom_description ?? null,
          JSON.stringify(Array.isArray(repo.custom_tags) ? repo.custom_tags : []),
          repo.custom_category ?? null, (repo.category_locked === true || repo.category_locked === 1) ? 1 : 0, repo.last_edited ?? null,
          (repo.subscribed_to_releases === true || repo.subscribed_to_releases === 1) ? 1 : 0,
          repo.archive_backed_up_at ?? null,
          repo.archive_backup_path ?? null,
          typeof repo.archive_backup_size === 'number' ? repo.archive_backup_size : null,
          repo.mirror_backed_up_at ?? null,
          repo.mirror_backup_path ?? null,
          typeof repo.mirror_backup_size === 'number' ? repo.mirror_backup_size : null
        );
        count++;
      }
      return count;
    });

    const count = upsert();
    res.json({ upserted: count });
  } catch (err) {
    console.error('PUT /api/repositories error:', err);
    res.status(500).json({ error: 'Failed to upsert repositories', code: 'UPSERT_REPOSITORIES_FAILED' });
  }
});

// PATCH /api/repositories/:id
router.patch('/api/repositories/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const updates = req.body as Record<string, unknown>;

    const allowedFields: Record<string, (v: unknown) => unknown> = {
      ai_summary: (v) => v,
      ai_tags: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      ai_platforms: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      analyzed_at: (v) => v,
      analysis_failed: (v) => (v === true || v === 1) ? 1 : 0,
      custom_description: (v) => v,
      custom_tags: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      custom_category: (v) => v,
      category_locked: (v) => (v === true || v === 1) ? 1 : 0,
      last_edited: (v) => v,
      subscribed_to_releases: (v) => (v === true || v === 1) ? 1 : 0,
      description: (v) => v,
      name: (v) => v,
      star_sources: (v) => JSON.stringify(Array.isArray(v) ? v : []),
      archive_backed_up_at: (v) => v,
      archive_backup_path: (v) => v,
      archive_backup_size: (v) => typeof v === 'number' ? v : null,
      mirror_backed_up_at: (v) => v,
      mirror_backup_path: (v) => v,
      mirror_backup_size: (v) => typeof v === 'number' ? v : null,
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, transform] of Object.entries(allowedFields)) {
      if (key in updates) {
        setClauses.push(`${key} = ?`);
        values.push(transform(updates[key]));
      }
    }

    if (setClauses.length === 0) {
      res.status(400).json({ error: 'No valid fields to update', code: 'NO_VALID_FIELDS' });
      return;
    }

    values.push(id);
    db.prepare(`UPDATE repositories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

    const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' });
      return;
    }
    res.json(transformRepo(row));
  } catch (err) {
    console.error('PATCH /api/repositories error:', err);
    res.status(500).json({ error: 'Failed to update repository', code: 'UPDATE_REPOSITORY_FAILED' });
  }
});

// POST /api/repositories/mirror-backup
router.post('/api/repositories/mirror-backup', async (req, res) => {
  try {
    const db = getDb();
    const { repository, webdavConfigId } = req.body as {
      repository?: Record<string, unknown>;
      webdavConfigId?: string;
      githubToken?: string | null;
    };

    if (!repository || typeof repository.full_name !== 'string') {
      res.status(400).json({ error: 'repository with full_name required', code: 'REPOSITORY_REQUIRED' });
      return;
    }
    if (!webdavConfigId) {
      res.status(400).json({ error: 'webdavConfigId required', code: 'WEBDAV_CONFIG_ID_REQUIRED' });
      return;
    }

    const webdavRow = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(webdavConfigId) as Record<string, unknown> | undefined;
    if (!webdavRow) {
      res.status(404).json({ error: 'WebDAV config not found', code: 'WEBDAV_CONFIG_NOT_FOUND' });
      return;
    }

    let webdavPassword: string;
    try {
      webdavPassword = decrypt(webdavRow.password_encrypted as string, config.encryptionKey);
    } catch {
      res.status(500).json({ error: 'Failed to decrypt WebDAV password', code: 'WEBDAV_PASSWORD_DECRYPT_FAILED' });
      return;
    }

    let githubToken: string | null = typeof req.body.githubToken === 'string' && req.body.githubToken.trim()
      ? req.body.githubToken.trim()
      : null;

    const tokenRow = !githubToken
      ? db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as { value: string } | undefined
      : undefined;
    if (!githubToken && tokenRow?.value) {
      try {
        githubToken = decrypt(tokenRow.value, config.encryptionKey);
      } catch {
        res.status(500).json({ error: 'Failed to decrypt GitHub token', code: 'GITHUB_TOKEN_DECRYPT_FAILED' });
        return;
      }
    }

    const result = await backupRepositoryMirror({
      repository: {
        id: typeof repository.id === 'number' ? repository.id : undefined,
        full_name: repository.full_name,
        name: typeof repository.name === 'string' ? repository.name : undefined,
        html_url: typeof repository.html_url === 'string' ? repository.html_url : undefined,
        description: typeof repository.description === 'string' ? repository.description : null,
        language: typeof repository.language === 'string' ? repository.language : null,
        stargazers_count: typeof repository.stargazers_count === 'number' ? repository.stargazers_count : undefined,
        pushed_at: typeof repository.pushed_at === 'string' ? repository.pushed_at : undefined,
      },
      githubToken,
      webdavConfig: {
        url: webdavRow.url as string,
        username: webdavRow.username as string,
        password: webdavPassword,
        path: webdavRow.path as string,
      },
    });

    if (typeof repository.id === 'number') {
      db.prepare(`
        UPDATE repositories
        SET mirror_backed_up_at = ?, mirror_backup_path = ?, mirror_backup_size = ?
        WHERE id = ?
      `).run(result.backedUpAt, result.mirrorPath, result.size, repository.id);
    }

    res.json(result);
  } catch (err) {
    console.error('POST /api/repositories/mirror-backup error:', err);
    const message = err instanceof Error ? err.message : 'Failed to back up repository mirror';
    res.status(500).json({ error: message, code: 'MIRROR_BACKUP_FAILED' });
  }
});

// DELETE /api/repositories/:id
router.delete('/api/repositories/:id', (req, res) => {
  try {
    const idStr = req.params.id;
    if (!/^\d+$/.test(idStr)) {
      res.status(400).json({ error: 'Valid repository id required', code: 'INVALID_REPOSITORY_ID' });
      return;
    }
    const id = parseInt(idStr, 10);

    if (isNaN(id) || id <= 0) {
      res.status(400).json({ error: 'Valid repository id required', code: 'INVALID_REPOSITORY_ID' });
      return;
    }

    const db = getDb();
    const deleteReleases = db.prepare('DELETE FROM releases WHERE repo_id = ?');
    const deleteRepo = db.prepare('DELETE FROM repositories WHERE id = ?');

    const deleteAll = db.transaction(() => {
      const releaseResult = deleteReleases.run(id);
      const repoResult = deleteRepo.run(id);
      
      return {
        releasesDeleted: releaseResult.changes,
        repoDeleted: repoResult.changes
      };
    });

    const result = deleteAll();

    if (result.repoDeleted === 0) {
      res.status(404).json({ error: 'Repository not found', code: 'REPOSITORY_NOT_FOUND' });
      return;
    }

    res.json({ 
      deleted: true, 
      id,
      releasesDeleted: result.releasesDeleted
    });
  } catch (err) {
    console.error('DELETE /api/repositories/:id error:', err);
    res.status(500).json({ error: 'Failed to delete repository', code: 'DELETE_REPOSITORY_FAILED' });
  }
});

export default router;
