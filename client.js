/**
 * Browser half of the `dsh-customized-commands` bundle.
 *
 * S3 responsibilities:
 *   1. a shared command store fed by `POST /api/dsh-customized-commands`
 *      (`action: 'list'`), with subscribers for the settings page and the
 *      editor's blue-token decoration;
 *   2. a `/` trigger source that shows known custom commands under the
 *      "自定义命令" section, highlights their tokens through `lexicon`, and
 *      inserts `/name ` (never the long prompt) when a row is picked.
 *
 * The prompt expansion itself happens in the Host half on Enter, so the draft
 * always keeps the typed `/xxx` token.
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
    /** Host settings API path. */
    const C_ApiPath = '/api/dsh-customized-commands'
    /** Background refresh age before a menu open re-polls the Host. */
    const C_RefreshTtlMs = 5000

    /**
     * Whether one API row is usable as a custom command.
     * @param {unknown} command - candidate row.
     * @returns {boolean} true for a well-formed command.
     */
    function IsUsableCommand(command) {
      return (
        command !== null &&
        typeof command === 'object' &&
        typeof command.name === 'string' &&
        command.name !== '' &&
        typeof command.prompt === 'string'
      )
    }

    /**
     * Case-insensitive name/description match used by the menu.
     * @param {{ name: string, description?: string }} command - one command.
     * @param {string} query - lowercase query.
     * @returns {boolean} whether the row matches.
     */
    function MatchesQuery(command, query) {
      if (query === '') return true
      const name = command.name.toLowerCase()
      const description =
        typeof command.description === 'string' ? command.description.toLowerCase() : ''
      return name.includes(query) || description.includes(query)
    }

    /**
     * Shared command store.
     *
     * `loadedAt` also advances after a failed request, so a broken Host route
     * is retried only after the refresh TTL instead of on every keystroke.
     *
     * @returns {{
     *   GetSnapshot: () => object,
     *   Refresh: () => Promise<object>,
     *   Ready: () => Promise<object>,
     *   Subscribe: (listener: () => void) => (() => void),
     *   Names: () => string[],
     * }}
     */
    function CreateCommandStore() {
      let commands = []
      let ignored = []
      let error = null
      let filePath = ''
      let loaded = false
      let loadedAt = 0
      let loading = null
      const listeners = new Set()

      /** @returns {object} current immutable-by-convention snapshot. */
      function GetSnapshot() {
        return { commands, ignored, error, filePath, loaded, loadedAt }
      }

      /** Notify every subscriber; one failure must not starve the rest. */
      function Publish() {
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (failure) {
            console.error('[dsh-customized-commands] store subscriber failed:', failure)
          }
        }
      }

      /**
       * Read the list from the Host API.
       * @returns {Promise<object>} successful API payload.
       */
      async function FetchList() {
        const response = await fetch(new URL(C_ApiPath, document.baseURI), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'list' }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const value = await response.json()
        if (value === null || typeof value !== 'object' || value.ok !== true) {
          throw new Error(
            value !== null && typeof value === 'object' && typeof value.message === 'string'
              ? value.message
              : 'list failed',
          )
        }
        return value
      }

      /**
       * Re-read the command list. Concurrent callers share one request.
       * @returns {Promise<object>} snapshot after the attempt.
       */
      function Refresh() {
        if (loading !== null) return loading
        loading = (async () => {
          try {
            const value = await FetchList()
            commands = Array.isArray(value.commands) ? value.commands.filter(IsUsableCommand) : []
            ignored = Array.isArray(value.ignored) ? value.ignored : []
            error = value.error === undefined ? null : value.error
            filePath = typeof value.filePath === 'string' ? value.filePath : ''
            loaded = true
          } catch (failure) {
            error = {
              code: 'unreachable',
              message: '无法读取自定义命令（插件 Host 端可能尚未加载）',
              detail: String(failure !== null && typeof failure === 'object' ? failure.message : failure),
            }
          } finally {
            loading = null
            loadedAt = Date.now()
            Publish()
          }
          return GetSnapshot()
        })()
        return loading
      }

      /**
       * Await the first load, then serve the cache. A stale cache triggers one
       * background refresh (never blocking the menu open).
       * @returns {Promise<object>} snapshot.
       */
      async function Ready() {
        if (loadedAt === 0) {
          await Refresh()
          return GetSnapshot()
        }
        if (Date.now() - loadedAt > C_RefreshTtlMs) void Refresh()
        return GetSnapshot()
      }

      /**
       * Register a change listener.
       * @param {() => void} listener - callback.
       * @returns {() => void} disposer.
       */
      function Subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }

      /** @returns {string[]} current command names. */
      function Names() {
        return commands.map((command) => command.name)
      }

      return { GetSnapshot, Refresh, Ready, Subscribe, Names }
    }

    /**
     * S3 settings placeholder: live store status plus a reload action. S5
     * replaces it with the full command manager.
     * @param {object} store - shared command store.
     * @returns {Function} React component.
     */
    function CreateSettingsStatus(store) {
      return function SettingsStatus() {
        const [, setRevision] = React.useState(0)
        React.useEffect(() => store.Subscribe(() => setRevision((value) => value + 1)), [])

        const snapshot = store.GetSnapshot()
        const children = [
          h('h2', { key: 'title', style: { margin: '0 0 8px', fontSize: '1.05em' } }, '自定义命令'),
          h(
            'p',
            { key: 'status', style: { margin: '0 0 6px' } },
            snapshot.loaded ? `已加载 ${snapshot.commands.length} 条命令。` : '正在读取命令…',
          ),
        ]
        if (snapshot.error !== null) {
          children.push(
            h('p', { key: 'error', style: { margin: '0 0 6px' } }, `⚠︎ ${snapshot.error.message}`),
          )
        }
        if (snapshot.ignored.length > 0) {
          children.push(
            h(
              'p',
              { key: 'ignored', style: { margin: '0 0 6px' } },
              `有 ${snapshot.ignored.length} 条命令被忽略（名称非法、与内置命令冲突或重复）。`,
            ),
          )
        }
        if (snapshot.filePath !== '') {
          children.push(
            h(
              'p',
              { key: 'path', style: { margin: '0 0 6px', opacity: 0.7, wordBreak: 'break-all' } },
              `数据文件：${snapshot.filePath}`,
            ),
          )
        }
        children.push(
          h(
            'div',
            { key: 'actions', style: { margin: '8px 0' } },
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  void store.Refresh()
                },
              },
              '重新加载',
            ),
          ),
        )
        children.push(
          h(
            'p',
            { key: 'next', style: { margin: 0, opacity: 0.7 } },
            '命令的新建、修改与删除将在 S5 实现。',
          ),
        )
        return h(
          'div',
          { className: 'dcc-settings', style: { padding: '8px 4px', lineHeight: 1.7 } },
          children,
        )
      }
    }

    /**
     * Build the `/` trigger source over the shared store.
     *
     * IMPORTANT: `candidates` must return a Promise — ui-input-trigger calls
     * `.then()` on the returned value directly.
     *
     * @param {object} store - shared command store.
     * @returns {object} one plugin-owned slash source.
     */
    function CreateSlashSource(store) {
      return {
        trigger: '/',
        name: C_SourceName,
        order: 10,
        async candidates(_session, request) {
          const snapshot = await store.Ready()
          const query =
            request !== null && typeof request === 'object' && typeof request.query === 'string'
              ? request.query.trim().toLowerCase()
              : ''
          return snapshot.commands
            .filter((command) => MatchesQuery(command, query))
            .map((command) => ({
              name: command.name,
              description: typeof command.description === 'string' ? command.description : '',
              section: C_SectionLabel,
            }))
        },
        lexicon: () => store.Names(),
        subscribeLexicon: (_projection, listener) => store.Subscribe(listener),
        // Insert the short command token, never the (possibly long) prompt:
        // Enter expands it in the Host half.
        onPick: (pick) => ({ text: `/${pick.candidate.name} ` }),
      }
    }

    return {
      // `inputTriggers` is a hard dependency: the dynamic client sandbox gates
      // service access by this declaration, and Cordis holds activation until
      // the service exists.
      inject: ['slots', 'inputTriggers'],
      apply(ctx) {
        const store = CreateCommandStore()
        void store.Refresh()

        // Settings section: the shell owns navigation and the panel chrome.
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-customized-commands',
              order: 56,
              label: () => '自定义命令',
            },
            CreateSettingsStatus(store),
          ),
        )

        try {
          const triggers = ctx.get('inputTriggers') ?? ctx.inputTriggers
          if (triggers === undefined) {
            console.error(
              '[dsh-customized-commands] inputTriggers service unavailable; slash source disabled',
            )
            return
          }
          const dispose = triggers.registerSource(CreateSlashSource(store))
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
          console.error('[dsh-customized-commands] slash source registration failed:', error)
        }
      },
    }
  },
})
