/**
 * Workspace Branding — ADMIN-only settings surface.
 *
 * Allows workspace administrators to:
 *  - Upload / remove a custom logo (png, jpeg, webp; ≤4 MB).
 *  - Set a custom accent color with preset swatches, live preview, and reset.
 *
 * Non-admins see an access-denied message matching the audit-log page pattern.
 *
 * Route: /workspaces/:workspaceId/branding
 */
import { useRef, useState, useEffect, useId } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Role } from '@next-lane/shared';
import { AppHeader } from '@/components/AppHeader';
import { WorkspaceSettingsNav } from '@/components/WorkspaceSettingsNav';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import {
  useWorkspaces,
  useMyRole,
  useUpdateWorkspaceBranding,
  useUploadWorkspaceLogo,
  useDeleteWorkspaceLogo,
} from '@/api/workspaces';
import { applyBrandColor } from '@/lib/applyBrandColor';
import { errorMessage } from '@/lib/errorMessage';
import { getApiUrl } from '@/api/config';
import { cn } from '@/lib/cn';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

/** Preset brand-color swatches — visually distinct, accessible choices. */
const PRESET_COLORS = [
  { label: 'Cobalt',    value: '#2563eb' }, // default electric blue
  { label: 'Indigo',   value: '#4f46e5' },
  { label: 'Violet',   value: '#7c3aed' },
  { label: 'Rose',     value: '#e11d48' },
  { label: 'Orange',   value: '#ea580c' },
  { label: 'Amber',    value: '#d97706' },
  { label: 'Emerald',  value: '#059669' },
  { label: 'Teal',     value: '#0d9488' },
  { label: 'Cyan',     value: '#0891b2' },
  { label: 'Graphite', value: '#374151' },
];

// ── Logo section ──────────────────────────────────────────────────────────────

function LogoSection({ workspaceId }: { workspaceId: string }) {
  const toast = useToast();
  const workspacesQuery = useWorkspaces();
  const workspace = workspacesQuery.data?.find((w) => w.id === workspaceId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const upload = useUploadWorkspaceLogo(workspaceId);
  const remove = useDeleteWorkspaceLogo(workspaceId);

  // Build the current logo src (append a v param to bust cache after changes).
  const logoSrc = workspace?.logoUrl
    ? `${getApiUrl()}/api${workspace.logoUrl}`
    : null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileError(null);

    if (!ALLOWED_MIME.includes(file.type)) {
      setFileError('Only PNG, JPEG, and WebP images are supported.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(`File is too large (max 4 MB). Yours is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      e.target.value = '';
      return;
    }

    // Local preview.
    const url = URL.createObjectURL(file);
    setPreview(url);

    upload.mutate(file, {
      onSuccess: () => {
        toast.success('Logo updated.');
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      onError: (err) => {
        toast.error(errorMessage(err, 'Logo upload failed.'));
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    });
  }

  function handleRemove() {
    remove.mutate(undefined, {
      onSuccess: () => toast.success('Logo removed.'),
      onError: (err) => toast.error(errorMessage(err, 'Could not remove logo.')),
    });
  }

  const displaySrc = preview ?? logoSrc;

  return (
    <section
      className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card"
      aria-labelledby="logo-section-heading"
    >
      <h2 id="logo-section-heading" className="mb-1 text-sm font-semibold text-ink-900">
        Workspace logo
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        Shown in the app header in place of the default Next Lane mark.
        PNG, JPEG, or WebP, up to 4 MB.
      </p>

      <div className="flex flex-wrap items-start gap-4">
        {/* Preview box */}
        <div className="flex h-16 w-32 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-200 bg-ink-50 p-2">
          {displaySrc ? (
            <img
              src={displaySrc}
              alt="Logo preview"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-xs text-ink-400">No logo</span>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="logo-upload-input"
            className={cn(
              'inline-flex cursor-pointer items-center gap-2 rounded-md border border-ink-200 bg-surface px-3.5 py-2 text-sm font-semibold text-ink-700 shadow-xs transition-colors duration-[120ms]',
              'hover:border-ink-300 hover:bg-ink-50 focus-within:ring-2 focus-within:ring-signal-200',
              upload.isPending && 'cursor-not-allowed opacity-60',
            )}
          >
            {upload.isPending ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-signal-600" aria-hidden="true" />
                Uploading…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4-4m0 0L8 12m4-4v12" />
                </svg>
                {logoSrc ? 'Replace logo' : 'Upload logo'}
              </>
            )}
            <input
              id="logo-upload-input"
              data-testid="logo-upload-input"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={handleFileChange}
              disabled={upload.isPending}
              aria-describedby={fileError ? 'logo-file-error' : undefined}
            />
          </label>

          {logoSrc && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="logo-remove"
              onClick={handleRemove}
              loading={remove.isPending}
              disabled={upload.isPending}
              className="justify-start text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              Remove logo
            </Button>
          )}
        </div>
      </div>

      {fileError && (
        <p id="logo-file-error" role="alert" className="mt-3 text-sm text-red-600">
          {fileError}
        </p>
      )}
    </section>
  );
}

/**
 * Normalize a hex color string to the server's required 6-digit form.
 * Expands CSS 3-digit shorthand (`#abc` -> `#aabbcc`); 6-digit input passes
 * through unchanged (lower-cased for consistency). Returns null if `hex` is
 * not a valid 3- or 6-digit hex string.
 *
 * Client and server previously disagreed here: the client's live-preview
 * regex accepted 3-digit shorthand (perfectly valid CSS) but the server DTO
 * only accepted 6-digit, so Save on `#fff` round-tripped a raw 400 with the
 * internal `brandColor` DTO field name in the message (SETTINGS-2). We pick
 * "normalize on submit" over "reject 3-digit" since shorthand hex is
 * standard and rejecting it would be the more surprising choice.
 */
export function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  const shortMatch = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(trimmed);
  if (shortMatch) {
    const [, r, g, b] = shortMatch;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

// ── Color section ─────────────────────────────────────────────────────────────

function ColorSection({ workspaceId }: { workspaceId: string }) {
  const colorInputId = useId();
  const toast = useToast();
  const workspacesQuery = useWorkspaces();
  const workspace = workspacesQuery.data?.find((w) => w.id === workspaceId);

  const [localColor, setLocalColor] = useState<string>(
    workspace?.brandColor ?? '#2563eb',
  );
  // Keep local state in sync when workspace loads/changes.
  useEffect(() => {
    if (workspace?.brandColor !== undefined) {
      setLocalColor(workspace.brandColor ?? '#2563eb');
    }
  }, [workspace?.brandColor]);

  const update = useUpdateWorkspaceBranding(workspaceId);
  const [hexError, setHexError] = useState<string | null>(null);

  // Live preview: apply color as user edits (without saving).
  function handleColorChange(hex: string) {
    setLocalColor(hex);
    setHexError(null);
    applyBrandColor(hex);
  }

  function handleSave() {
    // Normalize 3-digit CSS shorthand (#fff) to the 6-digit form the server
    // requires before submitting, so a value the live preview accepted as
    // valid never round-trips a raw server 400 (SETTINGS-2).
    const normalized = normalizeHex(localColor);
    if (!normalized) {
      const msg = 'Enter a valid hex color, like #2563eb or #06f.';
      setHexError(msg);
      toast.error(msg);
      return;
    }
    setHexError(null);
    update.mutate(
      { brandColor: normalized },
      {
        onSuccess: () => {
          setLocalColor(normalized);
          toast.success('Brand color saved.');
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not save brand color.'));
        },
      },
    );
  }

  function handleReset() {
    update.mutate(
      { brandColor: null },
      {
        onSuccess: () => {
          toast.success('Brand color reset to default.');
          setLocalColor('#2563eb');
          applyBrandColor(null);
        },
        onError: (err) => {
          toast.error(errorMessage(err, 'Could not reset brand color.'));
        },
      },
    );
  }

  const isDefault = !workspace?.brandColor;

  return (
    <section
      className="rounded-xl border border-ink-200 bg-surface p-5 shadow-card"
      aria-labelledby="color-section-heading"
      data-testid="branding-settings"
    >
      <h2 id="color-section-heading" className="mb-1 text-sm font-semibold text-ink-900">
        Accent color
      </h2>
      <p className="mb-4 text-sm text-ink-500">
        Sets the primary action color across the workspace. Choose a preset or enter any hex value.
      </p>

      {/* Preset swatches */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Color presets">
        {PRESET_COLORS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => handleColorChange(preset.value)}
            aria-label={preset.label}
            aria-pressed={localColor.toLowerCase() === preset.value}
            className={cn(
              'h-7 w-7 rounded-full transition-all duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              localColor.toLowerCase() === preset.value
                ? 'ring-2 ring-offset-2 ring-ink-400 scale-110'
                : 'hover:scale-105',
            )}
            style={{ backgroundColor: preset.value }}
            title={preset.label}
          />
        ))}
      </div>

      {/* Hex input */}
      <div className="mb-5 flex items-end gap-3">
        <div className="w-40">
          <Field label="Hex value" htmlFor={colorInputId}>
            <div className="flex items-center gap-2">
              {/* Color swatch inline with input */}
              <span
                className="h-6 w-6 shrink-0 rounded border border-ink-200"
                style={{ backgroundColor: localColor }}
                aria-hidden="true"
              />
              <Input
                id={colorInputId}
                data-testid="brand-color-input"
                type="text"
                value={localColor}
                onChange={(e) => {
                  const v = e.target.value;
                  setLocalColor(v);
                  setHexError(null);
                  // Only apply if it looks like a valid hex.
                  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
                    applyBrandColor(v);
                  }
                }}
                aria-describedby={hexError ? 'brand-color-error' : undefined}
                onBlur={() => {
                  // Snap to valid hex on blur; revert to saved color if invalid.
                  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(localColor)) {
                    const saved = workspace?.brandColor ?? '#2563eb';
                    setLocalColor(saved);
                    applyBrandColor(saved === '#2563eb' ? null : saved);
                  }
                }}
                placeholder="#2563eb"
                className="font-mono"
                aria-label="Accent color hex value"
                spellCheck={false}
              />
            </div>
          </Field>
        </div>
      </div>

      {hexError && (
        <p
          id="brand-color-error"
          role="alert"
          className="-mt-3 mb-5 text-sm text-red-600"
        >
          {hexError}
        </p>
      )}

      {/* Live preview */}
      <div className="mb-5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-500">
          Preview
        </p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-100 bg-ink-50 p-3">
          {/* Primary button */}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-semibold text-white shadow-xs transition-all duration-[120ms]"
            style={{ backgroundColor: localColor }}
            aria-label="Primary button preview"
            tabIndex={-1}
          >
            Create issue
          </button>
          {/* Active nav link */}
          <span
            className="inline-flex items-center rounded px-2.5 py-1.5 text-sm font-semibold"
            style={{ backgroundColor: `${localColor}18`, color: localColor }}
            aria-hidden="true"
          >
            Active nav
          </span>
          {/* Status chip */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
            style={{ backgroundColor: localColor }}
            aria-hidden="true"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-surface/80"
              aria-hidden="true"
            />
            In Progress
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="brand-color-save"
          onClick={handleSave}
          loading={update.isPending}
          disabled={update.isPending}
        >
          Save color
        </Button>
        {!isDefault && (
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={update.isPending}
          >
            Reset to default
          </Button>
        )}
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function WorkspaceBrandingPage() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();

  const myRole = useMyRole(workspaceId);
  const isAdmin = myRole === Role.ADMIN;

  const workspacesQuery = useWorkspaces();
  const workspaceName = workspacesQuery.data?.find((w) => w.id === workspaceId)?.name;

  // ── Access denied ─────────────────────────────────────────────────────────

  if (myRole === null && workspacesQuery.isLoading) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <LoadingState label="Loading…" />
      </Shell>
    );
  }

  if (myRole === null && workspacesQuery.isError) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <ErrorState
          error={workspacesQuery.error}
          onRetry={() => void workspacesQuery.refetch()}
        />
      </Shell>
    );
  }

  if (!isAdmin) {
    return (
      <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 p-12 text-center">
          <svg
            className="h-12 w-12 text-ink-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <h2 className="text-base font-semibold text-ink-700">
            Admin access required
          </h2>
          <p className="max-w-xs text-sm text-ink-500">
            Only workspace administrators can manage branding settings.
          </p>
        </div>
      </Shell>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  return (
    <Shell workspaceName={workspaceName} workspaceId={workspaceId}>
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-ink-900">Branding</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Customize how this workspace looks across the app.
          </p>
        </div>

        <div className="space-y-5">
          <LogoSection workspaceId={workspaceId} />
          <ColorSection workspaceId={workspaceId} />
        </div>
      </div>
    </Shell>
  );
}

// ── Shell (matches WorkspaceMembersPage / WorkspaceAuditLogPage pattern) ──────

function Shell({
  children,
  workspaceName,
  workspaceId,
}: {
  children: React.ReactNode;
  workspaceName: string | undefined;
  workspaceId: string;
}) {
  return (
    <div className="flex h-screen flex-col overflow-x-clip">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Link
            to="/"
            className="shrink-0 text-sm text-ink-400 hover:text-ink-600"
            aria-label="Back to dashboard"
          >
            Dashboard
          </Link>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="min-w-0 truncate text-sm text-ink-500">
            {workspaceName ?? 'Workspace'}
          </span>
          <span className="shrink-0 text-ink-300">/</span>
          <span className="shrink-0 text-sm font-semibold text-ink-900">
            Branding
          </span>
        </div>
      </AppHeader>
      <WorkspaceSettingsNav workspaceId={workspaceId} />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
