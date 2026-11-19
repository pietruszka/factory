import DefaultTheme from 'vitepress/theme'
import NotFound from 'vitepress/dist/client/theme-default/NotFound.vue'
import { withBase } from 'vitepress'
import { h, type FunctionalComponent } from 'vue'
import type { Theme } from 'vitepress'
import './not-found.css'

const recoveryLinks = [
  ['/getting-started.html', 'Getting started'],
  ['/flow.html', 'End-to-end flow'],
  ['/architecture.html', 'Architecture'],
] as const

// 404.md is the not-found route. VitePress leaves #app empty and the default
// theme renders NotFound instead of that file's Markdown. This slot keeps
// NotFound and adds the recovery links.
const NotFoundWithLinks: FunctionalComponent = () =>
  h('div', { class: 'vp-not-found-slot' }, [
    h(NotFound),
    h('nav', { 'aria-label': 'Docs pages' }, [
      h('p', 'Or open one of these pages:'),
      h(
        'ul',
        recoveryLinks.map(([href, text]) =>
          h('li', [h('a', { href: withBase(href) }, text)]),
        ),
      ),
    ]),
  ])

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'not-found': () => h(NotFoundWithLinks),
    })
  },
} satisfies Theme
