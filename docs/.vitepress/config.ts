import { defineConfig } from 'vitepress';

const repo = 'https://github.com/tarun9715m/terraform-planlens';

export default defineConfig({
  title: 'planlens',
  description: 'See exactly what a Terraform or OpenTofu plan will create, update, replace and destroy, including what terraform plan hides.',
  base: '/terraform-planlens/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/terraform-planlens/favicon.svg' }],
    ['meta', { property: 'og:title', content: 'planlens' }],
    ['meta', { property: 'og:description', content: 'See what your Terraform plan really does, including what terraform plan hides.' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Features', link: '/guide/features' },
      { text: 'CLI', link: '/guide/cli' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'Releases', link: `${repo}/releases` },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Why planlens', link: '/guide/why' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Getting started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Using planlens',
          items: [
            { text: 'Features', link: '/guide/features' },
            { text: 'Shareable reports', link: '/guide/reports' },
            { text: 'Use in CI', link: '/guide/ci' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/guide/cli' },
            { text: 'Privacy and security', link: '/guide/privacy' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: repo }],
    search: { provider: 'local' },
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    footer: { message: 'Released under the MIT License.', copyright: 'Copyright © 2026 tarun9715m' },
  },
});
