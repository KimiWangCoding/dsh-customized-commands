# dsh-customized-commands

DeepSeek Harness 插件：自定义以 `/` 开头的命令，在 prompt 中键入后于回车时展开为完整 prompt；命令保存在本地 JSON，可在「设置 → 自定义命令」中新建、修改、删除。

- **兼容**：DeepSeek Harness **0.2.2-rc.1**
- **形态**：Host 半 + 浏览器 Client 半，纯 JavaScript bundle，无构建步骤、无第三方运行时依赖
- **数据**：`%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`

## 功能

- **设置页**：独立的「自定义命令」栏目，支持列表、新建、编辑（含改名）、删除、重新加载。
- **`/` 菜单**：`/` 提示框中出现独立的「自定义命令」分组，每行显示命令名称与简述；按名称/简述过滤。
- **蓝色高亮**：键入合法 `/xxx` 时与内置命令同样显示为蓝色 token。
- **菜单选中**：插入短 token `/xxx `（不会插入长 prompt）。
- **回车展开**：消息进入模型步骤前，把 `/xxx` 替换为命令 prompt，并在 prompt 前后各加一个换行符，使其独立成段。
  - 支持句中（`请 /review 这段`）与一条消息多个命令；
  - 命令前后必须由空格或换行分隔；未知命令与紧贴标点的 token 不展开；
  - 围栏代码块（``` / ~~~）与同一行的反引号代码中的 `/xxx` 保持字面。
- **本地存储**：原子写入；覆盖前自动备份；JSON 损坏、非法条目、内置命令冲突均有容错与设置页提醒。
- **中英双语**：设置页文案跟随 DSH 语言（zh / en）；样式使用 `--dsw-alias-*` 主题 token，明暗主题一致。

## 安装

安装会修改当前 DSH profile（`package.json` / `node_modules` / Loader 组合），需经明确批准：

```
plugin_manager install_bundle  target: <本目录绝对路径>
```

- 安装结果为 `application: applied` 即生效；若提示 `restart-required`，重启 Harness。
- 本插件以 `link:` 方式登记到 profile，修改 `client.js` 后刷新页面即可加载新的浏览器半；修改 Host 半（`index.js` / `lib/*`）后需要重启。

## 使用

1. 打开「设置 → 自定义命令」，点击「新建命令」。
2. 填写：
   - **命令名**：`/` 后的部分，例如 `review`；
   - **简述**：显示在 `/` 菜单中；
   - **Prompt**：回车后被插入的完整文本，可多行。
3. 保存后：
   - 在输入框键入 `/review`，token 会蓝色高亮；
   - 在 `/` 菜单中选择该行会插入 `/review `；
   - 按回车发送时，插件把 token 替换为 prompt（前后各一个换行）。
4. 句中用法：`请 /review 这段代码` → 模型收到 `请 \n<prompt>\n 这段代码`。

### 当前行为说明（重要）

回车后，**会话历史中的用户消息与模型请求都是展开后的 prompt**；输入框在发送前始终显示 `/xxx`（发送后清空）。

这是当前版本接受的取舍：0.2.2-rc.1 中 `agent/pre-step` 既是模型请求消息的来源，也是持久化 `user/message` 的来源，且请求对象被深度冻结，无法在不修改 DSH 内部的前提下只改请求、保留历史。详细分析见 `dsh-tasks.md` §11。

## 数据文件

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

- 路径：`%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`（不存在时保存才创建）。
- **保存**：先写临时文件再原子替换；覆盖已有文件前生成备份：
  - 可解析文件 → `commands.json.bak-<时间戳>`；
  - 损坏文件 → `commands.json.broken-<时间戳>`（原内容保留，便于修复）。
- **读取**：
  - 文件缺失 → 空列表；
  - 无法读取 / JSON 语法错误 / 顶层格式错误 → 不加载任何命令，设置页显示红色提醒；
  - 单条非法（名称格式、内置冲突、重复、空 prompt）→ 忽略该条，其余正常加载，设置页显示黄色提醒。
- 单条上限：名称 32 字符、简述 200 字符、prompt 100000 字符。

## 命令名与保留名

- 合法格式：`^[a-z0-9][a-z0-9_-]*$`（小写字母或数字开头，可含 `_`、`-`）。
- 保留名（与内置命令冲突即非法）：
  `compact`、`export`、`feedback`、`file`、`goal`、`model`、`permission`、`plan`
  —— 另加运行时其它插件注册的命令名，由 Host 在保存/加载时合并检查。
- 设置页输入非法名称会提示并拒绝保存；JSON 中的非法条目被忽略。

## 错误处理

- 设置页顶部显示：
  - 红色：文件级错误（不可读 / JSON 错误 / 顶层格式错误）；
  - 黄色：被忽略条目（名称与原因）；
  - 绿色/红色：保存、删除、重新加载的结果。
- Host API 不可用（例如纯 CLI profile 没有 `connection` 服务）时：仅禁用设置页读写，回车展开仍然工作。
- 展开过程中的任何异常都会降级为原样放行，不阻塞对话。

## 卸载

```
plugin_manager remove_bundle  target: @kimiwangcoding/dsh-customized-commands
```

数据文件不会被自动删除；如需彻底清理，手动删除 `%USERPROFILE%\.dsh\dsh-customized-commands\`。

## 开发

```
node test/all.mjs
```

- 共 **57** 项测试（存储、展开、API、pre-step、发送路径、客户端数据层等）。
- 沙箱环境下不要使用 `node --test`（test runner 会 spawn 子进程并触发 EPERM）；直接运行 `test/all.mjs` 即可在进程内执行全部用例。

## 代码结构

```
dsh-customized-commands/
├─ package.json          # npm 清单、dsh.bundle / dsh.client 声明
├─ cordis.patch.yml      # Loader 插入行
├─ index.js              # Host 半：pre-step 展开 + 设置 API 注册
├─ client.js             # 浏览器半：命令 store、/ 触发源、设置页
├─ lib/
│  ├─ command-store.js   # commands.json 读写、校验、原子写、备份、损坏保护
│  ├─ expander.js        # /xxx 扫描与 prompt 展开（含代码块/行内代码保护）
│  ├─ api.js             # 设置页 HTTP actions：list / save / delete
│  └─ pre-step.js        # agent/pre-step 监听器工厂（可测试）
├─ test/                 # 单测入口 test/all.mjs
├─ locale/               # 插件清单文案（zh / en）
├─ icon.svg              # 插件图标
├─ LICENSE               # MIT
├─ dsh-tasks.md          # 任务清单、验收记录与设计取舍
└─ README.md
```

### 架构要点

- **Host**：`agent/pre-step`（`lib/pre-step.js`）在消息进入步骤前展开命令；`lib/api.js` 通过 `ctx.connection.fetch.register` 暴露 `POST /api/dsh-customized-commands`（`list` / `save` / `delete`）。
- **Client**：共享 store 从 API 拉取命令；`/` 触发源提供分组、查询过滤与 `lexicon` 蓝色高亮；设置页负责 CRUD 与提醒。
- **样式**：仅使用 `--dsw-alias-*` 主题 token（主按钮沿用官方充值按钮的 `button-primary-fill` / `label-primary-foreground` / `button-primary-hover`）。

## 已知限制

- 会话历史显示展开后的 prompt，而不是 `/xxx`（见上文「当前行为说明」）。
- 只改写文本块；图片与文件块原样保留。
- 不递归展开 prompt 内部再次出现的 `/xxx`。
- 命令名为 ASCII 小写；不支持中文命令名。
- 设置页 API 依赖 Web 连接；纯 CLI profile 只有回车展开。

## 状态

S0–S7 全部完成（2026-11-06）；当前 `main` 分支包含 S0–S6，S7 为文档与收尾。完整验收记录见 `dsh-tasks.md`。
