import React, { useState, useRef, useEffect } from 'react';
import { Settings, Calendar, Search, Moon, Sun, LogOut, RefreshCw, TrendingUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { GitHubApiService } from '../services/githubApi';
import { useDialog } from '../hooks/useDialog';

export const Header: React.FC = () => {
  const {
    user,
    theme,
    currentView,
    isLoading,
    lastSync,
    githubToken,
    starredUsername,
    sourceUsernames,
    repositories,
    setTheme,
    setCurrentView,
    setRepositories,
    setReleases,
    setLoading,
    setLastSync,
    logout,
    language,
  } = useAppStore();

  const { toast, confirm } = useDialog();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isTextWrapped, setIsTextWrapped] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkIfTextWrapped = () => {
      const windowWidth = window.innerWidth;
      if (windowWidth < 1100) {
        setIsTextWrapped(true);
        return;
      }

      if (navRef.current) {
        const buttons = navRef.current.querySelectorAll('button');
        let wrapped = false;
        buttons.forEach(button => {
          if (button.scrollHeight > button.clientHeight + 5) {
            wrapped = true;
          }
        });
        setIsTextWrapped(wrapped);
      }
    };

    checkIfTextWrapped();
    
    const resizeObserver = new ResizeObserver(checkIfTextWrapped);
    if (navRef.current) {
      resizeObserver.observe(navRef.current);
    }
    
    window.addEventListener('resize', checkIfTextWrapped);
    
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', checkIfTextWrapped);
    };
  }, []);

  const handleSync = async () => {
    let syncTargets = Array.from(new Set(
      (sourceUsernames.length > 0 ? sourceUsernames : [starredUsername || user?.login || ''])
        .map(username => username.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean)
    ));

    if (syncTargets.length === 0 && !githubToken) {
      toast(t('GitHub 用户名未找到，请重新登录。', 'GitHub username not found. Please login again.'), 'error');
      return;
    }

    setLoading(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      if (syncTargets.length === 0) {
        const currentUser = await githubApi.getCurrentUser();
        syncTargets = [currentUser.login.toLowerCase()];
      }
      const fetchedRepoMap = new Map<string, typeof repositories[number]>();
      const failedTargets: string[] = [];

      for (const username of syncTargets) {
        try {
          const reposForUser = await githubApi.getAllStarredRepositories(username);
          for (const repo of reposForUser) {
            const existingFetched = fetchedRepoMap.get(repo.full_name);
            const sourceMap = new Map(
              (existingFetched?.star_sources || []).map(source => [source.login.toLowerCase(), source])
            );
            sourceMap.set(username, { login: username, starred_at: repo.starred_at });
            fetchedRepoMap.set(repo.full_name, {
              ...(existingFetched || repo),
              ...repo,
              starred_at: [repo.starred_at, existingFetched?.starred_at]
                .filter((value): value is string => typeof value === 'string' && value.length > 0)
                .sort()
                .reverse()[0],
              star_sources: Array.from(sourceMap.values()),
            });
          }
        } catch (error) {
          failedTargets.push(username);
          console.error(`Failed to sync stars for @${username}:`, error);
        }
      }

      if (fetchedRepoMap.size === 0 && failedTargets.length > 0) {
        throw new Error(`All GitHub user syncs failed: ${failedTargets.join(', ')}`);
      }

      const newRepositories = Array.from(fetchedRepoMap.values());
      const existingRepoById = new Map(repositories.map(repo => [repo.id, repo]));
      const existingRepoByFullName = new Map(repositories.map(repo => [repo.full_name, repo]));
      const mergedRepositories = newRepositories.map(newRepo => {
        const existing = existingRepoById.get(newRepo.id) || existingRepoByFullName.get(newRepo.full_name);
        if (existing) {
          return {
            ...newRepo,
            id: existing.id,
            has_fetched_releases: existing.has_fetched_releases,
            last_release_fetch_time: existing.last_release_fetch_time,
            ai_summary: existing.ai_summary,
            ai_tags: existing.ai_tags,
            ai_platforms: existing.ai_platforms,
            analyzed_at: existing.analyzed_at,
            analysis_failed: existing.analysis_failed,
            custom_description: existing.custom_description,
            custom_tags: existing.custom_tags,
            custom_category: existing.custom_category,
            category_locked: existing.category_locked,
            last_edited: existing.last_edited,
            subscribed_to_releases: existing.subscribed_to_releases,
          };
        }
        return newRepo;
      });

      setRepositories(mergedRepositories);

      // Note: Release fetching is now handled by the Refresh button in Release Timeline
      // Header sync only syncs the starred repos list

      setLastSync(new Date().toISOString());
      console.log('Sync completed successfully');

      // 显示同步结果
      const oldRepoIds = new Set(repositories.map(repo => repo.id));
      const oldFullNames = new Set(repositories.map(repo => repo.full_name));
      const newRepoCount = newRepositories.filter(repo => !oldRepoIds.has(repo.id) && !oldFullNames.has(repo.full_name)).length;
      const targetLabel = syncTargets.map(username => `@${username}`).join(', ');
      const warningSuffix = failedTargets.length > 0
        ? t(`；${failedTargets.length} 个用户同步失败`, `; ${failedTargets.length} user sync(s) failed`)
        : '';
      if (newRepoCount > 0) {
        toast(t(`同步完成！从 ${targetLabel} 发现 ${newRepoCount} 个新仓库${warningSuffix}。`, `Sync completed! Found ${newRepoCount} new repositories from ${targetLabel}${warningSuffix}.`), 'success');
      } else {
        toast(t(`同步完成！${targetLabel} 的仓库都是最新的${warningSuffix}。`, `Sync completed! ${targetLabel}'s repositories are up to date${warningSuffix}.`), 'info');
      }
    } catch (error) {
      console.error('Sync failed:', error);
      if (error instanceof Error && error.message.includes('token')) {
        toast(t('GitHub token 已过期或无效，请重新登录。', 'GitHub token has expired or is invalid. Please login again.'), 'error');
        logout();
      } else {
        toast(t('同步失败，请检查网络连接。', 'Sync failed. Please check your network connection.'), 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
     
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

   
  return (
    <header className="bg-light-bg dark:bg-panel-dark border-b border-black/[0.06] dark:border-white/[0.04] sticky top-0 z-50 hd-drag lg:hd-drag relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {/* Logo and Title */}
          <div className="flex min-w-0 items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg overflow-hidden flex-shrink-0">
              <img 
                src="./icon.png" 
                alt="GitHub Stars Manager" 
                className="w-10 h-10 object-cover"
              />
            </div>
            <div className="min-w-0 hidden sm:block">
              <h1 className="truncate text-xl font-medium text-gray-900 dark:text-text-primary tracking-tight">
                GitHub Stars Manager
              </h1>
              <p className="truncate text-sm text-gray-500 dark:text-text-tertiary">
                AI-powered repository management
              </p>
            </div>
            <div className="min-w-0 sm:hidden">
              <h1 className="truncate text-base font-bold text-gray-900 dark:text-text-primary tracking-tight">
                GitHub Stars
              </h1>
            </div>
          </div>

          {/* Navigation - Desktop (≥1300px): Icon + Text + Badge */}
          <nav ref={navRef} className={`hidden xl:flex items-center space-x-1 hd-btns xl:hd-btns ${isTextWrapped ? 'flex-wrap' : ''}`}>
            <button
              onClick={() => setCurrentView('repositories')}
              aria-label={isTextWrapped ? t('仓库', 'Repositories') : undefined}
              title={isTextWrapped ? t('仓库', 'Repositories') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'repositories'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <Search className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && (
                <>
                  {t('仓库', 'Repositories')}
                  {currentView === 'repositories' && repositories.length > 0 && (
                    <span className="ml-1.5 text-sm text-brand-violet">
                      {repositories.length}
                    </span>
                  )}
                </>
              )}
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              aria-label={isTextWrapped ? t('发布', 'Releases') : undefined}
              title={isTextWrapped ? t('发布', 'Releases') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'releases'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <Calendar className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('发布', 'Releases')}
            </button>
            <button
              onClick={() => setCurrentView('subscription')}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'subscription'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <TrendingUp className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('趋势', 'Trending')}
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              aria-label={isTextWrapped ? t('设置', 'Settings') : undefined}
              title={isTextWrapped ? t('设置', 'Settings') : undefined}
              className={`${isTextWrapped ? 'p-2.5' : 'px-4 py-2'} rounded-lg font-medium transition-colors ${
                currentView === 'settings'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
            >
              <Settings className={`${isTextWrapped ? 'w-5 h-5' : 'w-4 h-4'} ${isTextWrapped ? '' : 'inline mr-2'}`} />
              {!isTextWrapped && t('设置', 'Settings')}
            </button>
          </nav>

          {/* Navigation - Tablet (768px-1299px): Icon only */}
          <nav className="hidden md:flex xl:hidden items-center space-x-1 hd-btns md:hd-btns">
            <button
              onClick={() => setCurrentView('repositories')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'repositories'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('仓库', 'Repositories')}
            >
              <Search className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('releases')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'releases'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('发布', 'Releases')}
            >
              <Calendar className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('subscription')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'subscription'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('趋势', 'Trending')}
            >
              <TrendingUp className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentView('settings')}
              className={`p-2.5 rounded-lg transition-colors ${
                currentView === 'settings'
                  ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                  : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
              }`}
              title={t('设置', 'Settings')}
            >
              <Settings className="w-5 h-5" />
            </button>
          </nav>

          {/* Mobile Dropdown Menu (<768px) */}
          {mobileMenuOpen && (
            <div className="absolute top-[calc(100%+1px)] left-0 right-0 md:hidden bg-light-bg dark:bg-surface-3 border-b border-black/[0.06] dark:border-white/[0.04] shadow-dialog animate-expand-fade z-[100]">
              <nav className="flex flex-col p-2 space-y-1">
                <button
                  onClick={() => {
                    setCurrentView('repositories');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'repositories'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <Search className="w-5 h-5 mr-3" />
                    {t('仓库', 'Repositories')}
                  </div>
                  {currentView === 'repositories' && repositories.length > 0 && (
                    <span className="text-sm text-brand-violet">
                      {repositories.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => {
                    setCurrentView('releases');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'releases'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <Calendar className="w-5 h-5 mr-3" />
                    {t('发布', 'Releases')}
                  </div>
                </button>
                <button
                  onClick={() => {
                    setCurrentView('subscription');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center justify-between px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'subscription'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <TrendingUp className="w-5 h-5 mr-3" />
                    {t('趋势', 'Trending')}
                  </div>
                </button>
                <button
                  onClick={() => {
                    setCurrentView('settings');
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center px-4 py-3 rounded-lg font-medium transition-colors ${
                    currentView === 'settings'
                      ? 'bg-white dark:bg-white/[0.1] text-gray-900 dark:text-text-primary shadow-sm border border-black/[0.06] dark:border-white/[0.04]'
                      : 'text-gray-700 dark:text-text-secondary hover:bg-light-surface dark:hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center">
                    <Settings className="w-5 h-5 mr-3" />
                    {t('设置', 'Settings')}
                  </div>
                </button>
              </nav>
            </div>
          )}

          {/* User Actions */}
          <div className="flex items-center gap-2 sm:gap-3 hd-btns lg:hd-btns">
            {/* Sync Status */}
            <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500 dark:text-text-tertiary">
              <span>{t('上次同步:', 'Last sync:')} {formatLastSync(lastSync)}</span>
              <button
                onClick={handleSync}
                disabled={isLoading}
                className="p-1 rounded hover:bg-light-surface dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                title={t('同步星标仓库列表（不包含Release）', 'Sync starred repos list (excludes Release)')}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="p-2 rounded-lg hover:bg-light-surface dark:hover:bg-white/5 transition-colors"
              title={t('切换主题', 'Toggle theme')}
            >
              {theme === 'light' ? (
                <Moon className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
              ) : (
                <Sun className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
              )}
            </button>

            {/* User Profile */}
            {user && (
              <div className="flex items-center space-x-2 sm:space-x-3">
                <img
                  src={user.avatar_url}
                  alt={user.name || user.login}
                  className="w-8 h-8 rounded-full"
                />
                <div className="min-w-0 hidden sm:block">
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-text-primary">
                    {user.name || user.login}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const confirmed = await confirm(
                      t('退出登录确认', 'Logout Confirmation'),
                      language === 'zh'
                        ? '退出后您的 AI 配置、WebDAV 设置、自定义分类等数据仍会保留。如需完全清除所有数据，请前往「设置 → 数据管理」。'
                        : 'Your AI configs, WebDAV settings, custom categories and other data will be preserved. To completely clear all data, please go to "Settings → Data Management".',
                      { type: 'warning' }
                    );
                    if (confirmed) {
                      logout();
                    }
                  }}
                    className="p-2 rounded-lg hover:bg-light-surface dark:hover:bg-white/5 transition-colors"
                  title={t('退出登录', 'Logout')}
                >
                  <LogOut className="w-4 h-4 text-gray-700 dark:text-text-secondary" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
