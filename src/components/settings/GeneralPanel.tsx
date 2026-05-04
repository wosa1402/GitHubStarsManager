import React, { useState } from 'react';
import { Globe, Package, Mail, ExternalLink, Github, Twitter, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { UpdateChecker } from '../UpdateChecker';
import { useAppStore } from '../../store/useAppStore';
import { version } from '../../../package.json';
import { PROJECT_REPO_URL } from '../../constants/project';
import { GitHubApiService } from '../../services/githubApi';

interface GeneralPanelProps {
  t: (zh: string, en: string) => string;
}

export const GeneralPanel: React.FC<GeneralPanelProps> = ({ t }) => {
  const {
    language,
    setLanguage,
    githubToken,
    sourceUsernames,
    addSourceUsername,
    removeSourceUsername,
  } = useAppStore();
  const [usernameInput, setUsernameInput] = useState('');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [userError, setUserError] = useState('');

  const handleAddUser = async () => {
    const normalized = usernameInput.trim().replace(/^@/, '').toLowerCase();
    if (!normalized) {
      setUserError(t('请输入 GitHub 用户名', 'Please enter a GitHub username'));
      return;
    }
    if (sourceUsernames.includes(normalized)) {
      setUserError(t('该用户已在同步列表中', 'This user is already in the sync list'));
      return;
    }

    setIsAddingUser(true);
    setUserError('');
    try {
      const githubApi = new GitHubApiService(githubToken);
      const githubUser = await githubApi.getUser(normalized);
      addSourceUsername(githubUser.login);
      setUsernameInput('');
    } catch (error) {
      console.error('Failed to add GitHub source user:', error);
      setUserError(t('无法找到该 GitHub 用户，请检查用户名', 'GitHub user not found. Please check the username'));
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleUsernameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !isAddingUser) {
      void handleAddUser();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Package className="w-6 h-6 text-gray-700 dark:text-text-secondary" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('通用设置', 'General Settings')}
        </h3>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Github className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('GitHub Star 用户', 'GitHub Star Users')}
          </h4>
        </div>

        <p className="text-sm text-gray-700 dark:text-text-tertiary mb-4">
          {t('使用当前 GitHub token 拉取这些公开用户的 Stars；同一个仓库会自动合并并标记来源用户。',
            'Use the current GitHub token to fetch public stars from these users. Duplicate repositories are merged and tagged by source user.')}
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={usernameInput}
            onChange={(event) => {
              setUsernameInput(event.target.value);
              setUserError('');
            }}
            onKeyDown={handleUsernameKeyDown}
            placeholder="octocat"
            disabled={isAddingUser}
            className="flex-1 px-4 py-3 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-brand-violet focus:border-transparent bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleAddUser}
            disabled={isAddingUser}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-brand-indigo hover:bg-brand-hover text-white rounded-lg transition-colors disabled:opacity-60"
          >
            {isAddingUser ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            <span>{t('添加用户', 'Add User')}</span>
          </button>
        </div>

        {userError && (
          <p className="mt-2 text-sm text-status-red dark:text-status-red">
            {userError}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {sourceUsernames.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              {t('还没有配置同步用户。', 'No source users configured yet.')}
            </p>
          ) : (
            sourceUsernames.map(username => (
              <div
                key={username}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] text-sm text-gray-900 dark:text-text-primary"
              >
                <span>@{username}</span>
                <button
                  type="button"
                  onClick={() => removeSourceUsername(username)}
                  className="p-1 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-200 dark:text-text-tertiary dark:hover:text-text-primary dark:hover:bg-white/[0.08] transition-colors"
                  title={t('移除用户', 'Remove user')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Globe className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('语言设置', 'Language Settings')}
          </h4>
        </div>
        
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10 transition-colors">
            <input
              type="radio"
              name="language"
              value="zh"
              checked={language === 'zh'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-brand-violet bg-light-surface border-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-text-primary">
                中文
              </span>
              <p className="text-xs text-gray-500 dark:text-text-tertiary">
                Simplified Chinese
              </p>
            </div>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10 transition-colors">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === 'en'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-brand-violet bg-light-surface border-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-text-primary">
                English
              </span>
              <p className="text-xs text-gray-500 dark:text-text-tertiary">
                US English
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Package className="w-5 h-5 text-gray-700 dark:text-text-secondary " />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('检查更新', 'Check for Updates')}
          </h4>
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700 dark:text-text-tertiary mb-1">
              {t(`当前版本: v${version}`, `Current Version: v${version}`)}
            </p>
            <p className="text-xs text-gray-500 dark:text-text-tertiary">
              {t('检查是否有新版本可用', 'Check if a new version is available')}
            </p>
          </div>
          <UpdateChecker />
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Mail className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('联系方式', 'Contact Information')}
          </h4>
        </div>
        
        <p className="text-sm text-gray-700 dark:text-text-tertiary mb-4">
          {t('如果您在使用过程中遇到任何问题或有建议，欢迎通过以下方式联系我：', 'If you encounter any issues or have suggestions while using the app, feel free to contact me through:')}
        </p>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              const newWindow = window.open('https://x.com/GoodMan_Lee', '_blank', 'noopener,noreferrer');
              if (newWindow) {
                newWindow.opener = null;
              }
            }}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-brand-indigo hover:bg-brand-hover text-white rounded-lg transition-colors"
          >
            <Twitter className="w-5 h-5" />
            <span>Twitter</span>
            <ExternalLink className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => {
              const newWindow = window.open(PROJECT_REPO_URL, '_blank', 'noopener,noreferrer');
              if (newWindow) {
                newWindow.opener = null;
              }
            }}
            className="flex items-center justify-center space-x-2 px-4 py-3 bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-900 dark:text-text-primary border border-black/[0.06] dark:border-white/[0.04] rounded-lg transition-colors"
          >
            <Github className="w-5 h-5" />
            <span>{t('GitHub', 'GitHub')}</span>
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
