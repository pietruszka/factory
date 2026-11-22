import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repository = 'https://github.com/pietruszka/factory'

export default withMermaid(defineConfig({
  title: 'factory',
  description:
    'Documentation for the pietruszka/factory repository: the intended factory flow, the files in the tree, the factory command line tool, the VitePress site, and GitHub Pages publishing.',
  lang: 'en-US',
  base: '/factory/',
  lastUpdated: true,
  sitemap: {
    // VitePress 1.6.4 does not prefix `base` onto sitemap URLs.
    // The trailing slash keeps relative page paths under /factory/.
    hostname: 'https://pietruszka.github.io/factory/',
  },
  themeConfig: {
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Flow', link: '/flow' },
      { text: 'Architecture', link: '/architecture' },
      {
        text: 'Reference',
        items: [
          { text: 'npm scripts', link: '/reference/scripts' },
          { text: 'The factory command', link: '/reference/cli' },
          { text: 'Testing', link: '/reference/testing' },
          { text: 'VitePress config', link: '/reference/configuration' },
          { text: 'GitHub Pages workflow', link: '/reference/pages-workflow' },
          { text: 'CLI facts (FAC-4)', link: '/reference/cli-facts' },
          { text: 'Model IDs by role (FAC-6)', link: '/reference/models' },
          { text: 'Factory config (FAC-14)', link: '/reference/factory-config' },
          { text: 'Event log (FAC-15)', link: '/reference/event-log' },
          { text: 'Run folder (FAC-16)', link: '/reference/run-folder' },
          { text: 'Worktrees (FAC-17)', link: '/reference/worktrees' },
          { text: 'Ports (FAC-18)', link: '/reference/ports' },
          { text: 'Worker runtime (FAC-19)', link: '/reference/worker-runtime' },
          { text: 'CLI test run report (FAC-8)', link: '/reference/cli-test-run-report' },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'End-to-end flow', link: '/flow' },
          { text: 'Architecture', link: '/architecture' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'npm scripts', link: '/reference/scripts' },
          { text: 'The factory command', link: '/reference/cli' },
          { text: 'Testing', link: '/reference/testing' },
          { text: 'VitePress config', link: '/reference/configuration' },
          { text: 'GitHub Pages workflow', link: '/reference/pages-workflow' },
          { text: 'CLI facts (FAC-4)', link: '/reference/cli-facts' },
          { text: 'Model IDs by role (FAC-6)', link: '/reference/models' },
          { text: 'Factory config (FAC-14)', link: '/reference/factory-config' },
          { text: 'Event log (FAC-15)', link: '/reference/event-log' },
          { text: 'Run folder (FAC-16)', link: '/reference/run-folder' },
          { text: 'Worktrees (FAC-17)', link: '/reference/worktrees' },
          { text: 'Ports (FAC-18)', link: '/reference/ports' },
          { text: 'Worker runtime (FAC-19)', link: '/reference/worker-runtime' },
          { text: 'CLI test run report (FAC-8)', link: '/reference/cli-test-run-report' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    socialLinks: [{ icon: 'github', link: repository }],
    footer: {
      message: 'No license file is present in this repository.',
    },
    outline: { level: [2, 3] },
  },
}))
