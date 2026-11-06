/**
 * Browser half of the `dsh-customized-commands` bundle.
 *
 * S0 scaffold. It registers:
 *   1. a placeholder "自定义命令" settings section, proving the
 *      `settings.section` slot integration;
 *   2. a guarded smoke-test `/` trigger source, proving that a plugin-owned
 *      slash source can contribute a menu section and a blue "text reference"
 *      decoration without affecting the built-in command source.
 *
 * The real command store and the expansion behaviour follow in later stages.
 */
window.__ModuleLoader__.load({
  id: '@kimiwangcoding/dsh-customized-commands',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Slash-source identity; also used by diagnostics. */
    const C_SourceName = 'dsh-customized-commands'
    /** Section heading rendered above this source's menu rows. */
    const C_SectionLabel = '自定义命令'

    /**
     * Placeholder page rendered inside the host settings panel.
     * Replaced by the command manager in S5.
     */
    function SettingsPlaceholder() {
      return h(
        'div',
        { className: 'dcc-settings', style: { padding: '8px 4px', lineHeight: 1.7 } },
        h('h2', { style: { margin: '0 0 8px', fontSize: '1.05em' } }, '自定义命令'),
        h(
          'p',
          { style: { margin: 0, opacity: 0.78 } },
          '插件骨架已加载（S0.2）。命令列表与编辑表单将在后续阶段实现。',
        ),
      )
    }

    /**
     * Build the S0 smoke-test trigger source.
     *
     * IMPORTANT: `candidates` must return a Promise. ui-input-trigger calls
     * `.then()` on the returned value directly, so a plain array throws inside
     * its fetch loop and leaves every later source (skills included) pending
     * forever — the menu then shows a permanent loading group and can freeze
     * the composer.
     *
     * @returns {object} one plugin-owned slash source.
     */
    function CreateSmokeSource() {
      return {
        trigger: '/',
        name: C_SourceName,
        order: 10,
        async candidates() {
          return [
            {
              name: 'dcc-hello',
              label: 'dcc-hello',
              description: 'S0.2 冒烟测试：验证自定义命令源与蓝色高亮',
              section: C_SectionLabel,
            },
          ]
        },
        lexicon: () => ['dcc-hello'],
        // A menu pick must insert the command token, never the (possibly very
        // long) prompt text: the token stays editable and the expansion is the
        // send-time job of the Host half.
        onPick: () => ({ text: '/dcc-hello ' }),
      }
    }

    return {
      // `inputTriggers` is a hard dependency: the dynamic client sandbox gates
      // service access by this declaration, and Cordis holds activation until
      // the service exists. Without it a cold boot runs this plugin before
      // ui-input-trigger provides the service, and the source would never be
      // registered.
      inject: ['slots', 'inputTriggers'],
      apply(ctx) {
        // Settings section: the shell owns navigation and the panel chrome.
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-customized-commands',
              order: 56,
              label: () => '自定义命令',
            },
            SettingsPlaceholder,
          ),
        )

        // S0 smoke test: one plugin-owned `/` source. The guard keeps a future
        // API drift from taking the settings page down with it.
        try {
          const triggers = ctx.get('inputTriggers') ?? ctx.inputTriggers
          if (triggers === undefined) {
            console.error(
              '[dsh-customized-commands] inputTriggers service unavailable; slash source disabled',
            )
            return
          }
          const dispose = triggers.registerSource(CreateSmokeSource())
          if (typeof dispose === 'function') {
            ctx.effect(() => () => {
              try {
                dispose()
              } catch (_error) {
                // Disposal must never surface a plugin error during unload.
              }
            })
          }
        } catch (error) {
          console.error(
            '[dsh-customized-commands] smoke source registration failed:',
            error,
          )
        }
      },
    }
  },
})
