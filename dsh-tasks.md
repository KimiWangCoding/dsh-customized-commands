# dsh-customized-commands — 开发任务清单

> 状态：**待批准开始**（S0 尚未执行；本文件是当前唯一已创建的项目文件）
> 创建日期：2026-11-06
> 目标运行时：DeepSeek Harness **0.2.2-rc.1**（已在本机确认：`@deepseek-ai/dsh-desktop-runtime` 及全部 `@deepseek-ai/dsh-*` 包均为 0.2.2-rc.1）

---

## 1. 项目基本信息

| 项目 | 值 |
|---|---|
| 工作目录 | `D:\My Documents\Deepseek Harness Coding\dsh-customized-commands` |
| npm 包名 | `@kimiwangcoding/dsh-customized-commands` |
| Loader 插件行 id | `dsh-customized-commands` |
| 插件模块名 | `dsh-customized-commands`（Loader 行 id；Client 工厂 id 必须等于 npm 包名，见 §3.7） |
| 数据文件 | `%USERPROFILE%\.dsh\dsh-customized-commands\commands.json` |
| 形态 | 普通 bundle（Host 半 + 浏览器 Client 半），无需编译步骤 |
| 版本控制 | Git（本机 git 2.55.0；禁止 push；提交需批准） |
| 语言 | 代码注释英文；界面中英双语（zh/en locale） |

---

## 2. 需求清单

### 2.1 原始功能需求

- **R1 命令展开**：用户自定义以 `/` 开头的命令；命令出现在 prompt 中时，在**回车后**翻译为该命令的 prompt 文本，替换到命令所在位置。
- **R2 设置页**：设置中新增独立栏目「自定义命令」，可新建、修改、删除命令。
- **R3 提示与高亮**：输入自定义命令时，按内置命令的样式**蓝色高亮**；`/` 提示框中出现独立的「自定义命令」栏目，显示命令名称与简述。
- **R4 持久化**：所有命令及对应关系保存在 `%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`；每条命令包含：命令名称（`/xxx` 中的 `xxx`）、简述、prompt。
- **R5 兼容性**：兼容 DSH 0.2.2-rc.1。

### 2.2 第二轮确认的新约束

- **N1 包名**：统一改为全小写 `@kimiwangcoding/dsh-customized-commands`（避免 npm 新包命名校验失败）。
- **N2 命令名规则**：合法命令名必须匹配 `^[a-z0-9][a-z0-9_-]*$`；**与内置命令重名同样视为非法**。
  - 设置页中输入非法名称：**弹窗警告并要求修改，不保存**该命令。
  - 读取 JSON 时遇到非法命令名：**直接忽略该命令**，其它合法命令正常加载。
  - 打开设置页时：**提醒用户**存在被忽略的非法命令（列出名称与原因）。
- **N3 JSON 损坏处理**：加载时 JSON 无法读取或格式错误 → **不加载任何自定义命令**；打开设置页时显示醒目提醒。
- **N4 交互与替换规则**：
  - 键入过程中命令**始终保持 `/xxx` 文本形式**，不在输入框内提前展开。
  - **按回车后**由插件内部完成替换：把 `/xxx` 替换为该命令的 prompt。
  - 外观上**完全效仿内置命令**（蓝色高亮、`/` 提示框条目样式）。
  - 命令 token 的**前后都必须由空格或换行分隔**（不能与其它文字粘连）。
  - 插入时在 prompt **前后各加一个换行符**，使 prompt 独立成段。
- **N5 Git 维护**：从项目开始即用 Git 管理，遵守既定 Git 守则；**任何情况下不执行 `git push`**。

---

## 3. 关键设计决策

### 3.1 数据文件格式

```json
{
  "version": 1,
  "commands": [
    {
      "name": "review",
      "description": "严格代码审查",
      "prompt": "请你以资深代码审查者的身份检查下面的内容，指出缺陷、风险与改进建议。"
    }
  ]
}
```

- `name`：不含 `/`，小写；`description`：显示在 `/` 菜单；`prompt`：替换文本（允许换行）。
- 文件不存在 → 视为空列表，并在首次保存时创建目录与文件。
- 写入策略：先写临时文件，再原子 rename；写入前对已有文件做一次备份 `commands.json.bak-<时间戳>`（见 §3.4）。
- 读取策略：按 UTF-8 解析；`version` 缺省视为 `1`；未知字段忽略并保留（不主动删除）。

### 3.2 命令名合法性与保留名

- 正则：`^[a-z0-9][a-z0-9_-]*$`（首字符为小写字母或数字；长度上限 32，防止 UI 与匹配异常）。
- 保留名集合 = 运行时的内置命令名（`/plan`、`/compact`、`/goal`、`/model`、`/permission` 等以实际注册表为准）∪ 本项目已存在的命令名。
- 判定顺序：格式 → 自身重名 → 内置冲突 → 空 prompt。
- 大小写不做自动转换；写入大写名称视为非法并提示。

### 3.3 非法条目的加载与提示

- 加载结果分为三部分：`commands`（合法）、`ignored`（非法条目：名称、原始下标、原因）、`error`（文件级错误：不可读 / JSON 语法错误）。
- 非法条目仅存在于提示信息中，不参与菜单、高亮与替换。
- 设置页顶部显示警示条（可关闭本次会话）：
  - 文件级错误：`commands.json 无法读取或格式错误，当前不会加载任何自定义命令。`
  - 条目级问题：列出被忽略的名称与原因（如 `与内置命令 plan 冲突`）。
- 保存时只写入合法结果；由于会重写整个文件，保存前自动备份原文件。

### 3.4 JSON 损坏 / 读取失败

- 启动加载失败：内存中 `commands = []`，记录文件级错误与错误详情（路径、错误消息）。
- 设置页打开时：显示红色警示条，并提供「重新加载」按钮；**不自动修复或覆盖损坏文件**。
- 用户执行保存时：先把损坏文件备份为 `commands.json.broken-<时间戳>`，再写入新的合法内容；提示中说明备份文件名。
- 不做自动轮询修复；可通过设置页「重新加载」或重启生效。

### 3.5 触发与替换规则（核心算法）

1. **识别**：在 prompt 文本中匹配 `/name`，要求：
   - `/` 位于文本开头，或前一个字符是空格 / 换行；
   - `name` 精确命中某条合法自定义命令（大小写敏感，全小写）；
   - `/name` 后一个字符是空格、换行或文本结尾。
2. **替换**：把 `/name` 这一段替换为 `"\n" + prompt + "\n"`；命令之外的文字原样保留；按出现顺序处理全部命中项。
3. **不做**：不替换命令参数（`/name` 后紧跟的额外文字原样保留在展开文本之后，天然由 §3.5.2 的分隔保留）；不解析嵌套命令；不处理代码块内的 `/xxx`（保持字面文本，视为普通文字）。
4. **回车后执行**：替换发生在消息进入模型请求之前；输入框与聊天记录中保留用户键入的 `/xxx`（详见 Q1）。

### 3.6 UI 集成点（0.2.2-rc.1 已确认）

| 能力 | 集成点 |
|---|---|
| 设置页栏目 | Client：`ctx.slots.inject('settings.section', …)`，`id: 'dsh-customized-commands'`、`label: '自定义命令'` |
| `/` 菜单栏目 | Client：`ctx.get('inputTriggers').registerSource({ trigger: '/', name: 'dsh-customized-commands', candidates, onPick, lexicon, matchEnter?, matchSpace? })`；候选行携带 `section: '自定义命令'`，菜单按 section 渲染分组标题 |
| 菜单显示名称 + 简述 | 候选行 `label` / `description`（简述取自 `description`） |
| 蓝色高亮 | 触发源 `lexicon` 返回全部合法命令名；编辑器 `scanTextRefs` 把 `/name` 渲染为蓝色文本引用装饰 |
| 选中后插入 | 触发源 `onPick` 返回 `{ text }`：把键入的 `/xxx` 片段替换为 `"\n" + prompt + "\n"` |
| 发送时替换 | Host：`agent/pre-step` waterfall；在 `PreStepDecision.kind === 'enter'` 时改写 `messages`，未命中时原样返回 `next()` 的结果 |
| 设置页读写 | Host：`ctx.connection.fetch.register({ path: '/api/dsh-customized-commands/…', … })`；Client：同源 `fetch`，`credentials: 'same-origin'` |

### 3.7 包与模块命名

- npm 包名：`@kimiwangcoding/dsh-customized-commands`。
- Loader 行：`id: dsh-customized-commands`，`name: '@kimiwangcoding/dsh-customized-commands'`。
- Client 工厂 id **必须**等于 npm 包名（`window.__ModuleLoader__.load({ id: '@kimiwangcoding/dsh-customized-commands', … })`）；这是 DSH 的模块表约定，不能用裸 `dsh-customized-commands` 作为工厂 id。
- `dsh.client.inject`：`['@deepseek-ai/dsh-client-ui-settings', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-input-trigger']`（仅用于激活顺序，不直接 import 这些包）。

### 3.8 设置页功能

- 列表：名称、简述、prompt 摘要、编辑/删除按钮。
- 新建/编辑表单：名称、简述、prompt（多行文本域）；保存前前端 + 后端双重校验。
- 删除：二次确认。
- 无效输入：弹窗/内联错误，说明原因（格式、重名、与内置冲突、空 prompt），不保存。
- 警示区：文件级错误、被忽略条目、当前保留名冲突情况。
- 中英双语：跟随 `ctx.locale`，至少提供 zh/en 文案。
- 样式：使用 `--dsw-alias-*` 主题 token，明暗色可用；交互沿用宿主设置页的列表/表单风格。

### 3.9 Host / Client 通信

- Host 提供三条 POST 动作（同一路由，body `{ action, … }`）：
  - `list` → `{ ok, commands, ignored, error }`
  - `save` → `{ ok, command }` 或 `{ ok: false, message }`
  - `delete` → `{ ok }`
- 统一错误结构：`{ ok: false, message }`；HTTP 状态码使用 200（业务错误）或 4xx（请求错误）。
- Client 端维护内存缓存 + 订阅者；保存/删除成功后刷新缓存并广播（触发源 `subscribeLexicon` 同步刷新高亮与菜单）。

---

## 4. 子任务拆分

> 每个子任务完成后暂停汇报；测试通过并经你同意后才 `git commit`。禁止 `push`。

### S0 — 环境与工程骨架
**产出**
- `git init`（项目目录内）、`.gitignore`、分支 `dsh_development_20261106_1`（先 `git branch --list` 确认不冲突）。
- `package.json`：包名、版本、`type: module`、`exports`（`.`、`./client`、`./locale/*.json`、`./icon`）、`dsh.bundle.patch`、`dsh.client`、`files`。
- `cordis.patch.yml`（`insert` 行）。
- `locale/zh.json`、`locale/en.json`（`meta.title` / `meta.description`）。
- `icon.svg`（原创图标）。
- `index.js` / `client.js` 占位（最小可加载、可注册一个测试槽位）。
- `README.md` 初稿。

**验收**
- `node --check` 通过；JSON 可解析；图标为有效 SVG。
- 最小插件可通过 `plugin_manager install_bundle` 安装（安装动作到时单独申请批准）。
- 在设置中能看到「自定义命令」栏目占位页；`/` 菜单能出现测试源（最小验证）。

### S1 — Host 存储层与展开核心
**产出**
- `lib/command-store.js`：
  - `ResolveCommandsPath()`（`%USERPROFILE%` / `os.homedir()`）、`LoadStore()`、`SaveStore()`、`ValidateCommandName()`、`ValidateCommand()`、`ResolveReservedNames()`。
  - 原子写、备份、损坏文件保护、`ignored`/`error` 结构。
- `lib/expander.js`：
  - `ScanCommandTokens(text, names)`、`ExpandCommandTokens(text, commands)`（换行包裹、多命中、边界规则）。
- `test/store.test.mjs`、`test/expander.test.mjs`：临时目录、无外部依赖。

**验收**
- 单测覆盖：名称校验、内置冲突、未知字段、损坏 JSON、原子写/备份、边界（开头/结尾/句中/粘连/多命中）、换行包裹。
- 不触碰真实 `%USERPROFILE%\.dsh\...`（测试使用临时目录）。

### S2 — Host HTTP API 与发送前展开
**产出**
- Host 注册 `/api/dsh-customized-commands` 路由（`ctx.connection.fetch.register`，参照 `dsh-ppt` 的成熟写法）。
- `list` / `save` / `delete` 动作与校验。
- `agent/pre-step` 监听：仅在命中合法 `/xxx` 时改写文本块并保留 `startsRequestSeries` 等字段；异常时降级为原样放行。
- 命令注册表变更时刷新保留名集合（`commands/change`）。

**验收**
- 通过浏览器设置页完成完整 CRUD（S5 完成后联调）。
- 构造 `/review` 消息提交后，模型收到的内容为展开文本（通过会话日志/回复核对）。
- 未命中、非法命令、普通文本均原样通过，不改变现有会话行为。

### S3 — Client 数据层与 `/` 触发源
**产出**
- Client 缓存与订阅（`list` 拉取、错误/ignored 状态、刷新）。
- 注册 `/` 触发源：
  - `candidates`：按查询过滤，返回 `{ name, label, description, section: '自定义命令' }`。
  - `lexicon`：合法命令名列表（蓝色高亮）。
  - `onPick`：`{ text: '\n' + prompt + '\n' }`（替换键入片段）。
  - `subscribeLexicon`：缓存变化时通知编辑器重扫。
- 不在输入框内提前展开；命令始终以 `/xxx` 文本显示。

**验收**
- 键入 `/` 出现「自定义命令」分组，行内显示名称与简述。
- 键入合法 `/xxx` 蓝色高亮；非法/未知命令不高亮。
- 从菜单选择后，`/xxx` 被替换为换行包裹的 prompt，可继续编辑。
- 输入法与中文输入场景不破坏文本。

### S4 — 回车后替换（发送路径）
**产出**
- 确认并落地 `agent/pre-step` 替换路径（S2）。
- 边界处理：同一消息多个命令、命令在句中、命令在开头/结尾、命令前后紧贴标点（不替换）。
- 与内置命令、`@` 引用、代码块共存时的行为验证。

**验收**
- 键入 `请 /review 这段代码` 回车 → 模型收到 `请\n<prompt>\n 这段代码`（按 §3.5 规则）。
- 键入 `/review`（单独一行）回车 → 模型收到换行包裹的 prompt。
- 非法命令/未知命令正常作为普通文本发送。
- 不修改会话日志格式、不新增事件类型。

### S5 — 设置页 UI
**产出**
- `settings.section` 页面：警示条、列表、新建/编辑/删除、校验提示、重新加载。
- 中英文案；主题 token 样式；表单键盘可达性与基本无障碍标签。
- 保存/删除后立即刷新缓存并同步高亮、菜单。

**验收**
- 新建合法命令 → 文件写入正确、菜单与高亮生效（刷新页面后仍生效）。
- 非法名称 → 弹窗警告且不保存；后端同样拒绝。
- 删除 → 二次确认，删除后菜单与高亮同步移除。
- JSON 损坏 → 打开设置页出现红色提醒，且不加载任何命令；保存时生成备份。

### S6 — 安装与端到端验证
**产出**
- `plugin_manager install_bundle`（单独申请批准；可能需重启 Harness）。
- 浏览器端验证清单全部通过（见 §5）。
- 回归：不破坏内置 `/plan`、`/compact` 等命令；普通消息不受影响。

**验收**
- 安装结果为 `application: applied`（或按结果处理 `restart-required`）。
- 在本机 Web GUI 中逐项实测并记录结果（菜单、高亮、替换、设置、持久化、错误场景）。

### S7 — 文档与收尾
**产出**
- `README.md`：安装、使用、命令格式、文件格式、错误处理、卸载、兼容性说明。
- 代码注释（英文）、命名规范复核（见 §7）。
- 最终总结（文件清单、功能、关键类/方法、后续事项）。

**验收**
- 文档与实现一致；`node --check`、单测全绿。

---

## 5. 端到端验收清单

1. [ ] 设置 → 自定义命令 栏目存在，标题、图标、描述正确（中/英）。
2. [ ] 新建 `review`：菜单「自定义命令」出现名称 + 简述；输入 `/review` 蓝色高亮。
3. [ ] 输入 `/review` 回车：模型收到的请求包含换行包裹的 prompt，且替换位置正确。
4. [ ] 输入 `请 /review 这段` 回车：句中替换正确，前后文字保留。
5. [ ] 菜单选择 `review`：输入框内 `/review` 被替换为换行包裹的 prompt，可编辑后发送。
6. [ ] `/reviewX`、`abc/review`、`/review。` 不触发替换（边界规则）。
7. [ ] 非法名称（大写、中文、符号、内置冲突）保存被拒绝并提示。
8. [ ] JSON 中非法条目被忽略，设置页提醒。
9. [ ] JSON 损坏：不加载任何命令，设置页提醒；保存前生成备份。
10. [ ] 重启 Harness 后配置与效果保留。
11. [ ] 内置 `/plan` 等命令、普通对话、`@` 引用不受影响。
12. [ ] 无 console 报错；卸载插件后无残留监听。

---

## 6. Git 工作流

- 项目目录内初始化独立仓库：`git init`（在获得开始指示后执行）。
- `.gitignore`：`node_modules/`、`*.log`、临时测试目录、编辑器缓存。
- 每个任务/子任务开始时创建分支：`dsh_development_<YYYYMMDD>_<n>`，`n` 从 1 递增；先 `git branch --list` 确认唯一。当前日期（2026-11-06）对应：`dsh_development_20261106_1`。
- 完成子任务后**不立即 commit**；先汇报，等你测试。
- 测试通过并收到明确同意后才 `git commit`；提交信息说明子任务与验证结果。
- **禁止 `git push`**；未经指示不合并分支、不改动主分支。
- 每天重置 `n`；跨天的新任务使用新日期编号。

---

## 7. 代码规范（遵循工作区 AGENTS.md）

- 函数、类、命名空间、全局变量：首字母大写驼峰（如 `LoadStore`、`ExpandCommandTokens`）。
- 局部变量、参数：首字母小写驼峰（如 `rawInput`）。
- 常量：`C_` 前缀（如 `C_RoutePath`）。
- 与成员/关键变量对应的构造参数/函数参数：`_` + 驼峰（如 `_Store`）。
- 每个类与非平凡函数、关键公开接口写英文注释（用途 + 重要实现细节）。
- 无构建步骤：Host 使用 ESM，Client 使用 `window.__ModuleLoader__` 工厂；不引入第三方运行时依赖。

---

## 8. 待确认假设（若非你所愿，告知后我调整）

- **Q1（重要）**：回车后，**模型收到的消息**是展开后的 prompt；而**输入框与聊天记录**保留用户键入的 `/xxx`。若你希望聊天记录也显示展开文本，需要改为「提交前客户端改写」路线（可行性需在 S4 冒烟验证），请明确。
- **Q2**：命令位于 prompt **最开头**（前面没有任何字符）视为合法边界；位于文本结尾（后面无字符）同样合法。
- **Q3**：同一 prompt 中多个合法 `/xxx` 按出现顺序**全部替换**。
- **Q4**：JSON 损坏时用户仍可保存；保存前自动备份损坏文件为 `commands.json.broken-<时间戳>`，并在设置页提示备份文件名。
- **Q5**：被忽略的非法条目**不会自动从文件删除**；用户下次保存时会以合法集合重写文件（并有备份），设置页会在保存前提示。

---

## 9. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| `inputTriggers` 不在 Inspect 目录中，但 `ui-commands` 实际使用 | 注册源 API 细节需按 0.2.2-rc.1 实测 | S0 最小烟雾验证；必要时对照 `dsh-client-ui-commands` / `dsh-client-ui-input-trigger` 源码 |
| 文本引用高亮与内置命令 chip 视觉不完全一致 | R3「完全效仿」可能不达标 | S0/S3 视觉比对；必要时增加 claim chip 方案（需更多内部行为支撑） |
| 聊天记录保留 `/xxx` 而非展开文本 | 与你预期可能不同 | Q1 确认；必要时在 S4 评估客户端提交前改写 |
| Host HTTP 路由依赖 `connection` 服务 | 路由不可用 | 用 `ctx.inject(['connection'])` 防御；不可用时降级为通过设置页触发宿主动作 |
| 安装/重载需要修改 profile | 未经批准不得执行 | 安装前单独申请；使用 `plugin_manager`，不改 profile 配置文件 |
| 大写包名 | 已改为全小写，风险解除 | — |
| 中文输入法与编辑器装饰冲突 | 高亮/替换异常 | S3 专项测试（IME composition 场景） |

---

## 10. 交付物

- 可直接安装的 bundle 目录（`package.json`、`cordis.patch.yml`、`index.js`、`client.js`、`lib/*`、`locale/*`、`icon.svg`）。
- `commands.json` 默认路径与格式说明。
- `README.md` 使用文档。
- `test/` 单元测试。
- 本任务清单（本文件）。
