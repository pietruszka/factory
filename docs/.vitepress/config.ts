import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const repository = 'https://github.com/pietruszka/factory'

export default withMermaid(defineConfig({
  title: 'factory',
  description:
    'Documentation for the pietruszka/factory repository: the intended factory flow, the files in the tree, the VitePress site, and GitHub Pages publishing. The repository has no application source.',
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
          { text: 'VitePress config', link: '/reference/configuration' },
          { text: 'GitHub Pages workflow', link: '/reference/pages-workflow' },
          { text: 'CLI facts (FAC-4)', link: '/reference/cli-facts' },
          { text: 'Model IDs by role (FAC-6)', link: '/reference/models' },
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
          { text: 'VitePress config', link: '/reference/configuration' },
          { text: 'GitHub Pages workflow', link: '/reference/pages-workflow' },
          { text: 'CLI facts (FAC-4)', link: '/reference/cli-facts' },
          { text: 'Model IDs by role (FAC-6)', link: '/reference/models' },
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
