/**
 * Browser half of the `dsh-customized-commands` bundle.
 *
 * Responsibilities:
 *   1. a shared command store fed by `POST /api/dsh-customized-commands`,
 *      with subscribers for the settings page and the editor's blue-token
 *      decoration;
 *   2. a `/` trigger source that shows known custom commands under the
 *      "自定义命令" section and inserts `/name ` (never the long prompt);
 *   3. the settings page: list, create, edit, delete, validation feedback,
 *      ignored-entry and broken-file warnings.
 *
 * Prompt expansion happens in the Host half on Enter, so the draft always keeps
 * the typed `/xxx` token.
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
    /** Client-side fast check; the Host remains the authority on reserved names. */
    const C_CommandNamePattern = /^[a-z0-9][a-z0-9_-]*$/

    /** Bilingual settings copy. */
    const C_Text = {
      zh: {
        sectionLabel: '自定义命令',
        title: '自定义命令',
        description: '定义以 / 开头的命令；回车时由 Host 展开为完整 prompt。',
        newCommand: '新建命令',
        editCommand: '编辑命令',
        reload: '重新加载',
        reloaded: '已重新读取。',
        edit: '编辑',
        remove: '删除',
        save: '保存',
        cancel: '取消',
        name: '命令名',
        nameHint: '小写字母或数字开头，可含 _ 和 -；不能与内置命令重名。',
        descriptionLabel: '简述',
        promptLabel: 'Prompt',
        loading: '正在读取命令…',
        empty: '还没有自定义命令。',
        emptyHint: '点击「新建命令」创建第一条。',
        saved: '已保存。',
        deleted: '已删除。',
        saveFailed: '保存失败。',
        deleteFailed: '删除失败。',
        loadFailed: '读取失败',
        ignored: (count) =>
          `有 ${count} 条命令被忽略（名称非法、与内置命令冲突或重复）。`,
        file: '数据文件',
        busy: '处理中…',
        invalidName:
          '命令名必须以小写字母或数字开头，且只能包含小写字母、数字、_ 和 -。',
        emptyPrompt: 'Prompt 不能为空。',
        confirmDelete: (name) => `确定删除 /${name} 吗？`,
        unknownEntry: '(未知名称)',
      },
      en: {
        sectionLabel: 'Custom commands',
        title: 'Custom commands',
        description: 'Define /xxx commands; the Host expands them into a full prompt on Enter.',
        newCommand: 'New command',
        editCommand: 'Edit command',
        reload: 'Reload',
        reloaded: 'Reloaded.',
        edit: 'Edit',
        remove: 'Delete',
        save: 'Save',
        cancel: 'Cancel',
        name: 'Name',
        nameHint:
          'Start with a lowercase letter or digit; _ and - are allowed. Must not collide with a built-in command.',
        descriptionLabel: 'Description',
        promptLabel: 'Prompt',
        loading: 'Loading commands…',
        empty: 'No custom commands yet.',
        emptyHint: 'Click "New command" to create the first one.',
        saved: 'Saved.',
        deleted: 'Deleted.',
        saveFailed: 'Save failed.',
        deleteFailed: 'Delete failed.',
        loadFailed: 'Load failed',
        ignored: (count) =>
          `${count} command(s) ignored (invalid name, built-in collision, or duplicate).`,
        file: 'Data file',
        busy: 'Working…',
        invalidName:
          'The name must start with a lowercase letter or digit and contain only lowercase letters, digits, _ and -.',
        emptyPrompt: 'The prompt cannot be empty.',
        confirmDelete: (name) => `Delete /${name}?`,
        unknownEntry: '(unknown name)',
      },
    }

    /** Component-local stylesheet; theme tokens keep light/dark parity. */
    const C_Css = `
      .dcc-settings { padding: 8px 4px; line-height: 1.7; }
      .dcc-title { margin: 0 0 6px; font-size: 1.05em; }
      .dcc-desc { margin: 0 0 10px; color: var(--dsw-alias-label-secondary); }
      .dcc-banner { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 9px 12px; margin: 10px 0; }
      .dcc-banner-error { border-color: var(--dsw-alias-state-error-primary); }
      .dcc-banner-warn { border-color: var(--dsw-alias-state-warn-primary); }
      .dcc-banner-success { border-color: var(--dsw-alias-state-success-primary); }
      .dcc-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; }
      .dcc-button { font: inherit; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: inherit; padding: 5px 12px; cursor: pointer; }
      .dcc-button:disabled { opacity: .5; cursor: default; }
      .dcc-button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
      @media (hover: hover) {
        .dcc-button:not(.dcc-button-primary):hover { background: var(--dsw-alias-bg-layer-2); }
        .dcc-button-primary:hover { background: var(--dsw-alias-button-primary-hover); }
      }
      .dcc-button-primary { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); font-weight: 500; }
      .dcc-button-danger { color: var(--dsw-alias-state-error-primary); }
      .dcc-form { display: grid; gap: 10px; margin: 12px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
      .dcc-label { display: grid; gap: 4px; font-size: 13px; }
      .dcc-input, .dcc-textarea { font: inherit; color: inherit; width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 7px 9px; background: var(--dsw-alias-bg-base); }
      .dcc-textarea { resize: vertical; min-height: 120px; }
      .dcc-list { border-top: 1px solid var(--dsw-alias-border-l1); }
      .dcc-row { display: grid; grid-template-columns: 130px minmax(0, 1fr) auto; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); align-items: start; }
      .dcc-name { font-family: ui-monospace, monospace; font-weight: 600; overflow-wrap: anywhere; }
      .dcc-preview { font-size: 12.5px; overflow-wrap: anywhere; }
      .dcc-actions { display: flex; gap: 6px; }
      .dcc-muted { color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
      .dcc-empty { padding: 16px 0; }
      .dcc-file { margin-top: 10px; overflow-wrap: anywhere; }
      .dcc-details { margin-top: 6px; }
    `

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
     * Send one JSON action to the Host settings API.
     * @param {object} body - JSON payload.
     * @returns {Promise<any>} parsed response.
     * @throws {Error} on a non-2xx response.
     */
    async function PostApi(body) {
      const response = await fetch(new URL(C_ApiPath, document.baseURI), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    /**
     * Build a locale-aware translator over the settings copy.
     * @param {object | undefined} locale - Client locale service when available.
     * @returns {() => typeof C_Text.zh} dictionary reader.
     */
    function CreateTranslator(locale) {
      /** @returns {'zh' | 'en'} active UI language. */
      function Language() {
        try {
          const snapshot = locale?.getSnapshot?.()
          const active = typeof snapshot?.active === 'string' ? snapshot.active.toLowerCase() : ''
          if (active.startsWith('en')) return 'en'
        } catch (_error) {
          // Fall through to Chinese.
        }
        return 'zh'
      }
      return function Translate() {
        return Language() === 'en' ? C_Text.en : C_Text.zh
      }
    }

    /**
     * Shared command store.
     *
     * `loadedAt` also advances after a failed request, so a broken Host route is
     * retried only after the refresh TTL instead of on every keystroke.
     *
     * @returns {{
     *   GetSnapshot: () => object,
     *   Apply: (value: object) => void,
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

      /** @returns {object} current snapshot. */
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
       * Adopt one successful API list payload (also used after save/delete).
       * @param {object} value - successful API payload.
       */
      function Apply(value) {
        commands = Array.isArray(value.commands) ? value.commands.filter(IsUsableCommand) : []
        ignored = Array.isArray(value.ignored) ? value.ignored : []
        error = value.error === undefined ? null : value.error
        filePath = typeof value.filePath === 'string' ? value.filePath : ''
        loaded = true
        loadedAt = Date.now()
        Publish()
      }

      /**
       * Re-read the command list. Concurrent callers share one request.
       * @returns {Promise<object>} snapshot after the attempt.
       */
      function Refresh() {
        if (loading !== null) return loading
        loading = (async () => {
          try {
            const value = await PostApi({ action: 'list' })
            if (value === null || typeof value !== 'object' || value.ok !== true) {
              throw new Error(
                value !== null && typeof value === 'object' && typeof value.message === 'string'
                  ? value.message
                  : 'list failed',
              )
            }
            Apply(value)
          } catch (failure) {
            error = {
              code: 'unreachable',
              message: '无法读取自定义命令（插件 Host 端可能尚未加载）',
              detail: String(
                failure !== null && typeof failure === 'object' ? failure.message : failure,
              ),
            }
            loadedAt = Date.now()
            Publish()
          } finally {
            loading = null
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

      return { GetSnapshot, Apply, Refresh, Ready, Subscribe, Names }
    }

    /**
     * Collapse and truncate a prompt for the list preview.
     * @param {string} text - prompt body.
     * @returns {string} one-line preview.
     */
    function Preview(text) {
      const collapsed = text.replace(/\s+/gu, ' ').trim()
      return collapsed.length > 120 ? `${collapsed.slice(0, 117)}…` : collapsed
    }

    /**
     * Settings page: command list, create/edit form, delete, warnings and
     * reload. Replaces the S3 status placeholder.
     *
     * @param {object} store - shared command store.
     * @param {object | undefined} locale - Client locale service.
     * @returns {Function} React component.
     */
    function CreateSettingsManager(store, locale) {
      const Translate = CreateTranslator(locale)

      return function SettingsManager() {
        const [, setRevision] = React.useState(0)
        const [editing, setEditing] = React.useState(null)
        const [notice, setNotice] = React.useState(null)
        const [busy, setBusy] = React.useState(false)

        React.useEffect(() => {
          const unsubscribeStore = store.Subscribe(() => setRevision((value) => value + 1))
          const unsubscribeLocale =
            typeof locale?.subscribe === 'function'
              ? locale.subscribe(() => setRevision((value) => value + 1))
              : undefined
          return () => {
            unsubscribeStore()
            if (typeof unsubscribeLocale === 'function') unsubscribeLocale()
          }
        }, [])

        const t = Translate()
        const snapshot = store.GetSnapshot()

        /** Open the create form. */
        function StartCreate() {
          setNotice(null)
          setEditing({ originalName: undefined, name: '', description: '', prompt: '' })
        }

        /**
         * Open the edit form for one command.
         * @param {object} command - current command.
         */
        function StartEdit(command) {
          setNotice(null)
          setEditing({
            originalName: command.name,
            name: command.name,
            description: typeof command.description === 'string' ? command.description : '',
            prompt: command.prompt,
          })
        }

        /**
         * Update one editor field.
         * @param {string} field - field name.
         * @param {string} value - new value.
         */
        function UpdateField(field, value) {
          setEditing((current) => (current === null ? current : { ...current, [field]: value }))
        }

        /** Persist the current editor state. */
        async function Submit() {
          if (editing === null || busy) return
          const name = editing.name.trim()
          if (!C_CommandNamePattern.test(name)) {
            setNotice({ kind: 'error', text: t.invalidName })
            return
          }
          if (editing.prompt.trim() === '') {
            setNotice({ kind: 'error', text: t.emptyPrompt })
            return
          }

          setBusy(true)
          setNotice(null)
          try {
            const payload = await PostApi({
              action: 'save',
              command: {
                name,
                description: editing.description,
                prompt: editing.prompt,
              },
              ...(editing.originalName === undefined
                ? {}
                : { originalName: editing.originalName }),
            })
            if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
              setNotice({
                kind: 'error',
                text:
                  payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
                    ? payload.message
                    : t.saveFailed,
              })
              return
            }
            store.Apply(payload)
            setEditing(null)
            setNotice({ kind: 'success', text: t.saved })
          } catch (error) {
            setNotice({ kind: 'error', text: String(error?.message ?? error) })
          } finally {
            setBusy(false)
          }
        }

        /**
         * Delete one command after confirmation.
         * @param {object} command - command to delete.
         */
        async function Remove(command) {
          if (busy) return
          if (
            typeof window !== 'undefined' &&
            typeof window.confirm === 'function' &&
            !window.confirm(t.confirmDelete(command.name))
          ) {
            return
          }
          setBusy(true)
          setNotice(null)
          try {
            const payload = await PostApi({ action: 'delete', name: command.name })
            if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
              setNotice({
                kind: 'error',
                text:
                  payload !== null && typeof payload === 'object' && typeof payload.message === 'string'
                    ? payload.message
                    : t.deleteFailed,
              })
              return
            }
            store.Apply(payload)
            setNotice({ kind: 'success', text: t.deleted })
          } catch (error) {
            setNotice({ kind: 'error', text: String(error?.message ?? error) })
          } finally {
            setBusy(false)
          }
        }

        /** Re-read the document from disk. */
        async function Reload() {
          if (busy) return
          setBusy(true)
          setNotice(null)
          try {
            await store.Refresh()
            if (store.GetSnapshot().error === null) {
              setNotice({ kind: 'success', text: t.reloaded })
            }
          } finally {
            setBusy(false)
          }
        }

        /** @returns {object} editor markup. */
        function RenderEditor() {
          if (editing === null) return null
          return h(
            'div',
            { className: 'dcc-form' },
            h(
              'h3',
              { style: { margin: 0, fontSize: '0.98em' } },
              editing.originalName === undefined ? t.newCommand : `${t.editCommand} /${editing.originalName}`,
            ),
            h(
              'label',
              { className: 'dcc-label' },
              t.name,
              h('input', {
                className: 'dcc-input',
                value: editing.name,
                placeholder: 'review',
                autoFocus: true,
                onChange: (event) => UpdateField('name', event.target.value),
              }),
              h('span', { className: 'dcc-muted' }, t.nameHint),
            ),
            h(
              'label',
              { className: 'dcc-label' },
              t.descriptionLabel,
              h('input', {
                className: 'dcc-input',
                value: editing.description,
                maxLength: 200,
                onChange: (event) => UpdateField('description', event.target.value),
              }),
            ),
            h(
              'label',
              { className: 'dcc-label' },
              t.promptLabel,
              h('textarea', {
                className: 'dcc-textarea',
                rows: 6,
                value: editing.prompt,
                onChange: (event) => UpdateField('prompt', event.target.value),
              }),
            ),
            h(
              'div',
              { className: 'dcc-toolbar' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcc-button dcc-button-primary',
                  disabled: busy,
                  onClick: Submit,
                },
                t.save,
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dcc-button',
                  disabled: busy,
                  onClick: () => {
                    setEditing(null)
                    setNotice(null)
                  },
                },
                t.cancel,
              ),
            ),
          )
        }

        /** @returns {object} command list markup. */
        function RenderList() {
          if (!snapshot.loaded) {
            return h('p', { className: 'dcc-muted' }, t.loading)
          }
          if (snapshot.commands.length === 0) {
            return h(
              'div',
              { className: 'dcc-empty' },
              h('p', { style: { margin: '0 0 4px' } }, t.empty),
              h('p', { className: 'dcc-muted', style: { margin: 0 } }, t.emptyHint),
            )
          }
          return h(
            'div',
            { className: 'dcc-list' },
            snapshot.commands.map((command) =>
              h(
                'div',
                { className: 'dcc-row', key: command.name },
                h('div', { className: 'dcc-name' }, `/${command.name}`),
                h(
                  'div',
                  null,
                  h(
                    'div',
                    null,
                    typeof command.description === 'string' && command.description !== ''
                      ? command.description
                      : h('span', { className: 'dcc-muted' }, '—'),
                  ),
                  h('div', { className: 'dcc-preview dcc-muted' }, Preview(command.prompt)),
                ),
                h(
                  'div',
                  { className: 'dcc-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dcc-button',
                      disabled: busy,
                      onClick: () => StartEdit(command),
                    },
                    t.edit,
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dcc-button dcc-button-danger',
                      disabled: busy,
                      onClick: () => Remove(command),
                    },
                    t.remove,
                  ),
                ),
              ),
            ),
          )
        }

        const children = [
          h('style', { key: 'style' }, C_Css),
          h('h2', { key: 'title', className: 'dcc-title' }, t.title),
          h('p', { key: 'desc', className: 'dcc-desc' }, t.description),
        ]

        if (snapshot.error !== null) {
          children.push(
            h(
              'div',
              { key: 'error', className: 'dcc-banner dcc-banner-error', role: 'alert' },
              h('strong', null, `${t.loadFailed}: `),
              h('span', null, snapshot.error.message),
              snapshot.error.detail
                ? h('div', { className: 'dcc-muted' }, snapshot.error.detail)
                : null,
            ),
          )
        }

        if (snapshot.ignored.length > 0) {
          children.push(
            h(
              'details',
              { key: 'ignored', className: 'dcc-banner dcc-banner-warn dcc-details' },
              h('summary', null, t.ignored(snapshot.ignored.length)),
              h(
                'ul',
                { style: { margin: '6px 0 0', paddingLeft: 20 } },
                snapshot.ignored.map((entry, index) =>
                  h(
                    'li',
                    { key: index },
                    `${typeof entry.name === 'string' && entry.name !== '' ? entry.name : t.unknownEntry}: ${typeof entry.message === 'string' ? entry.message : ''}`,
                  ),
                ),
              ),
            ),
          )
        }

        if (notice !== null) {
          children.push(
            h(
              'div',
              {
                key: 'notice',
                className: `dcc-banner ${notice.kind === 'error' ? 'dcc-banner-error' : 'dcc-banner-success'}`,
                role: 'status',
              },
              notice.text,
            ),
          )
        }

        children.push(
          h(
            'div',
            { key: 'toolbar', className: 'dcc-toolbar' },
            h(
              'button',
              {
                type: 'button',
                className: 'dcc-button dcc-button-primary',
                disabled: busy,
                onClick: StartCreate,
              },
              t.newCommand,
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dcc-button',
                disabled: busy,
                onClick: Reload,
              },
              t.reload,
            ),
            busy ? h('span', { className: 'dcc-muted' }, t.busy) : null,
          ),
        )

        const editor = RenderEditor()
        if (editor !== null) children.push(h('div', { key: 'editor' }, editor))
        children.push(h('div', { key: 'list' }, RenderList()))
        children.push(
          h(
            'p',
            { key: 'file', className: 'dcc-muted dcc-file' },
            `${t.file}: ${snapshot.filePath !== '' ? snapshot.filePath : '—'}`,
          ),
        )

        return h('div', { className: 'dcc-settings' }, children)
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

        const locale = ctx.get('locale')
        const Translate = CreateTranslator(locale)

        // Settings section: the shell owns navigation and the panel chrome.
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-customized-commands',
              order: 56,
              label: () => Translate().sectionLabel,
            },
            CreateSettingsManager(store, locale),
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
