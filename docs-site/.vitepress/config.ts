import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/Next-Lane/',
  lang: 'en-US',
  title: 'Next Lane',
  description:
    'Open-source, self-hosted issue and project tracker. Unlimited users, unlimited projects, unlimited automation — running entirely on your own hardware. MIT licensed.',

  // Dark is the canonical Overcastly aesthetic; the light/dark toggle is still available.
  appearance: 'dark',

  lastUpdated: true,

  // Ignore localhost links — these are valid for self-hosted deployments
  // but cannot be resolved at build time.
  ignoreDeadLinks: [/^http:\/\/localhost/],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/Next-Lane/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#4F8BFF' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Next Lane' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Open-source, self-hosted issue and project tracker. Free and unlimited.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: 'https://overcastly-ai.github.io/Next-Lane/screenshots/home-desktop.png',
      },
    ],
  ],

  themeConfig: {
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: 'Next Lane' },

    nav: [
      { text: 'Guide', link: '/guide/quick-start', activeMatch: '/guide/' },
      { text: 'Features', link: '/guide/features' },
      { text: 'Self-Hosting', link: '/guide/self-hosting' },
      { text: 'Architecture', link: '/guide/architecture' },
      {
        text: 'GitHub',
        link: 'https://github.com/Overcastly-AI/Next-Lane',
      },
      {
        text: 'Overcastly AI',
        link: 'https://overcastly.com',
      },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        collapsed: false,
        items: [
          { text: 'Quick Start', link: '/guide/quick-start' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Using Next Lane',
        collapsed: false,
        items: [
          { text: 'Features', link: '/guide/features' },
          { text: 'FAQ', link: '/guide/faq' },
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
        ],
      },
      {
        text: 'Operating',
        collapsed: false,
        items: [
          { text: 'Self-Hosting', link: '/guide/self-hosting' },
          { text: 'Security', link: '/guide/security' },
        ],
      },
      {
        text: 'Contributing',
        collapsed: false,
        items: [{ text: 'Contributing', link: '/guide/contributing' }],
      },
      {
        text: 'Reference',
        collapsed: false,
        items: [{ text: 'Architecture', link: '/guide/architecture' }],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Overcastly-AI/Next-Lane' },
    ],

    editLink: {
      pattern:
        'https://github.com/Overcastly-AI/Next-Lane/edit/main/docs-site/:path',
      text: 'Edit this page on GitHub',
    },

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the <a href="https://opensource.org/licenses/MIT">MIT License</a>. Built by <a href="https://overcastly.com">Overcastly AI</a>.',
      copyright:
        'Copyright &copy; 2024–present <a href="https://overcastly.com">Overcastly AI</a>',
    },

    lastUpdated: {
      text: 'Updated at',
      formatOptions: {
        dateStyle: 'full',
        timeStyle: 'short',
      },
    },
  },
})
