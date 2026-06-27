import { AppHeader } from '@/components/AppHeader';
import { ApiTokensSection } from '@/components/settings/ApiTokensSection';

/**
 * Personal profile settings page (/me/settings).
 *
 * Contains user-scoped settings that are not tied to any specific project or
 * workspace. Currently hosts:
 *   - API tokens (PATs for scripting / CI access)
 *
 * All authenticated users can access this page.
 */
export function ProfileSettingsPage() {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader />
      <main className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Profile settings
            </h1>
            <p className="text-sm text-slate-500">
              Manage your personal account settings.
            </p>
          </div>

          <ApiTokensSection />
        </div>
      </main>
    </div>
  );
}
