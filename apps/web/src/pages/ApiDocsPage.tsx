/**
 * ApiDocsPage — the API reference, inside the product.
 *
 * Founder: "I feel like there should be a place to view the swagger docs for
 * the users." Before this, the reference existed only as a URL you had to
 * already know, on a port you might have had to forward.
 *
 * THE EMBED IS CONDITIONAL, AND HONESTLY SO. The API serves
 * `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, so it can only be
 * framed when it is on this exact origin — which is the reverse-proxied
 * deployment (the default). When someone has pointed the app at a separate API
 * origin, the iframe would render a blank white box with a console error, so
 * this shows a link instead and says why. A page whose main content silently
 * fails is worse than one that admits the constraint.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '@/api/client';
import { Button } from '@/components/ui/Button';

/**
 * Where the API lives from the browser's point of view.
 *
 * `API_URL` is '' in the same-origin deployment, so the docs are simply /api
 * here; otherwise it is an absolute origin and they are over there.
 */
function useApiOrigin() {
  return useMemo(() => {
    const base = API_URL || '';
    const docsUrl = `${base}/api`;
    const specUrl = `${base}/api-json`;
    // Same-origin covers both the '' case and someone configuring the app's
    // own origin explicitly.
    let sameOrigin = true;
    if (base) {
      try {
        sameOrigin = new URL(base, window.location.href).origin === window.location.origin;
      } catch {
        sameOrigin = false;
      }
    }
    return { base: base || window.location.origin, docsUrl, specUrl, sameOrigin };
  }, []);
}

const SNIPPETS = {
  curl: (base: string) => `curl -s -H "Authorization: Bearer $NEXT_LANE_TOKEN" \\
  "${base}/api/projects?workspaceId=$WORKSPACE_ID" | jq .`,
  python: (base: string) => `import os, requests

BASE  = "${base}"
TOKEN = os.environ["NEXT_LANE_TOKEN"]      # nlp_...

s = requests.Session()
s.headers["Authorization"] = f"Bearer {TOKEN}"

projects = s.get(f"{BASE}/api/projects", params={"workspaceId": WORKSPACE_ID}).json()
issues   = s.get(f"{BASE}/api/issues", params={"projectId": projects[0]["id"]}).json()

for i in issues:
    print(i["key"], i["title"], i["status"]["name"])`,
  node: (base: string) => `const BASE = "${base}";
const token = process.env.NEXT_LANE_TOKEN;   // nlp_...

const res = await fetch(\`\${BASE}/api/issues?projectId=\${projectId}\`, {
  headers: { Authorization: \`Bearer \${token}\` },
});
const issues = await res.json();
console.log(issues.map((i) => \`\${i.key} \${i.title}\`));`,
};

type Lang = keyof typeof SNIPPETS;
const LANGS: { id: Lang; label: string }[] = [
  { id: 'curl', label: 'curl' },
  { id: 'python', label: 'Python' },
  { id: 'node', label: 'Node' },
];

export function ApiDocsPage() {
  const { base, docsUrl, specUrl, sameOrigin } = useApiOrigin();
  const [lang, setLang] = useState<Lang>('curl');
  const [copied, setCopied] = useState(false);

  const snippet = SNIPPETS[lang](base);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the code is selectable either way.
    }
  }

  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"
      data-testid="api-docs-page"
      /*
       * The two facts this page branches on, published for tests.
       *
       * A test that re-derives them from its own environment is guessing:
       * the resolved origin comes from a priority chain (runtime config.js →
       * build-time env → default) that only this component has walked, and a
       * test that got it wrong would assert the wrong branch and pass anyway.
       */
      data-api-origin={base}
      data-embedded={sameOrigin ? 'true' : 'false'}
    >
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink-900">API</h1>
        <p className="mt-1 text-sm text-ink-500">
          Everything the app does, it does through this API — so anything you
          can do here, a script can do too.
        </p>
      </header>

      {/* Getting started, before the reference: a route list answers "how" but
          not "where do I start". */}
      <section className="mb-6 rounded-xl border border-ink-200 bg-surface p-4 shadow-card sm:p-5">
        <h2 className="text-sm font-semibold text-ink-900">Start here</h2>
        <ol className="mt-3 space-y-2 text-sm text-ink-700">
          <li className="flex gap-2">
            <span className="font-semibold text-ink-400">1.</span>
            <span>
              Create a token in{' '}
              <Link
                to="/me/settings"
                className="font-medium text-signal-600 hover:underline"
                data-testid="api-docs-token-link"
              >
                Settings → API tokens
              </Link>
              . Scope it if the script only needs to read.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-ink-400">2.</span>
            <span>
              Send it as{' '}
              <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs">
                Authorization: Bearer nlp_…
              </code>
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-ink-400">3.</span>
            <span>
              Call{' '}
              <code
                className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs"
                data-testid="api-docs-base-url"
              >
                {base}/api
              </code>
            </span>
          </li>
        </ol>

        <div className="mt-4 overflow-hidden rounded-lg border border-ink-200">
          <div className="flex items-center justify-between border-b border-ink-200 bg-ink-50/60 px-2 py-1.5">
            <div className="flex gap-0.5">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLang(l.id)}
                  aria-pressed={lang === l.id}
                  data-testid={`api-docs-lang-${l.id}`}
                  className={
                    'rounded px-2 py-1 text-xs font-medium transition-colors duration-[120ms] ' +
                    (lang === l.id
                      ? 'bg-signal-600 text-white'
                      : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800')
                  }
                >
                  {l.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={copy}
              data-testid="api-docs-copy"
              className="rounded px-2 py-1 text-xs font-medium text-ink-500 transition-colors duration-[120ms] hover:bg-ink-100 hover:text-ink-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto bg-surface p-3 text-xs leading-relaxed text-ink-800">
            <code data-testid="api-docs-snippet">{snippet}</code>
          </pre>
        </div>
      </section>

      {/* The reference itself. */}
      <section className="rounded-xl border border-ink-200 bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Reference</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Every route, with its parameters and responses. Authorize with
              your token to call them from here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a href={specUrl} target="_blank" rel="noreferrer" data-testid="api-docs-spec-link">
              <Button size="sm" variant="secondary">
                OpenAPI spec
              </Button>
            </a>
            <a href={docsUrl} target="_blank" rel="noreferrer" data-testid="api-docs-open-new-tab">
              <Button size="sm" variant="secondary">
                Open in new tab
              </Button>
            </a>
          </div>
        </div>

        {sameOrigin ? (
          <iframe
            src={docsUrl}
            title="Next Lane API reference"
            data-testid="api-docs-frame"
            className="h-[70vh] w-full rounded-b-xl border-0 bg-surface"
          />
        ) : (
          <div
            className="px-4 py-8 text-center"
            data-testid="api-docs-cross-origin-note"
          >
            <p className="text-sm font-medium text-ink-700">
              The reference opens in a new tab on this install
            </p>
            <p className="mx-auto mt-1 max-w-xl text-xs text-ink-500">
              This app is configured to talk to the API at{' '}
              <code className="font-mono">{base}</code>, a different origin, and
              the API only allows itself to be framed by its own. Deployments
              that let the app serve the API on one origin — the default — show
              it inline here instead.
            </p>
            <a href={docsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block">
              <Button size="sm">Open the API reference</Button>
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
