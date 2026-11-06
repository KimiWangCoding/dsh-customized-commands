# dsh-customized-commands

DeepSeek Harness 插件：自定义以 `/` 开头的命令，在 prompt 中键入后于回车时展开为完整 prompt；命令保存在本地 JSON，可在「设置 → 自定义命令」中新建、修改、删除。

- **兼容**：DeepSeek Harness **0.2.2-rc.1**
- **数据**：`%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`
- **许可**：MIT

## 功能

- **设置页**：独立的「自定义命令」栏目，支持列表、新建、编辑（含改名）、删除、重新加载。
- **`/` 菜单**：`/` 提示框中出现独立的「自定义命令」分组，每行显示命令名称与简述；按名称/简述过滤。
- **蓝色高亮**：键入合法 `/xxx` 时与内置命令同样显示为蓝色 token。
- **菜单选中**：插入短 token `/xxx `（不会插入长 prompt）。
- **回车展开**：把 `/xxx` 替换为命令 prompt，并在 prompt 前后各加一个换行符，使其独立成段；支持句中（`请 /review 这段`）与一条消息多个命令。
- **本地存储**：原子写入；覆盖前自动备份；JSON 损坏、非法条目、内置命令冲突均有容错与设置页提醒。
- **中英双语**：设置页文案跟随 DSH 语言（zh / en）；样式适配明暗主题。

## 下载

GitHub 仓库：<https://github.com/KimiWangCoding/dsh-customized-commands>

```bash
git clone https://github.com/KimiWangCoding/dsh-customized-commands.git
```

也可以直接在 GitHub 页面下载 ZIP 并解压。

## 安装

拿到仓库目录（克隆或解压）后，在 DeepSeek Harness 中执行：

```
plugin_manager install_bundle  target: <克隆或解压后的目录绝对路径>
```

- 安装会修改当前 DSH profile（`package.json` / `node_modules` / Loader 组合），需要批准。
- 返回 `application: applied` 即生效；若提示 `restart-required`，重启 Harness。

## 使用

1. 打开「设置 → 自定义命令」，点击「新建命令」。
2. 填写：
   - **命令名**：`/` 后的部分，例如 `review`；
   - **简述**：显示在 `/` 菜单中；
   - **Prompt**：回车后被替换的完整文本，可多行。
3. 保存后：
   - 在输入框键入 `/review`，token 会蓝色高亮；
   - 在 `/` 菜单中选择该行会插入 `/review `；
   - 按回车发送时，`/review` 被替换为 prompt（前后各一个换行）。
4. 句中用法：`请 /review 这段代码` → 模型收到 `请 \n<prompt>\n 这段代码`。

## 注意事项

- **会话历史显示展开后的 prompt**：输入框在发送前保持 `/xxx`（发送后清空），但回车后会话历史与模型请求都包含展开后的 prompt。这是当前版本的行为。
- 命令前后必须由空格或换行分隔；未知命令、紧贴标点的 token 不展开。
- 围栏代码块（``` / ~~~）与同一行的反引号代码中的 `/xxx` 保持字面。
- 只改写文本块；图片与文件块原样保留；不递归展开 prompt 内部再次出现的 `/xxx`。
- 命令名必须匹配 `^[a-z0-9][a-z0-9_-]*$`，且不能与内置命令重名：
  `compact`、`export`、`feedback`、`file`、`goal`、`model`、`permission`、`plan`
  （另含运行时其它插件注册的命令名）。
- 设置页 API 依赖 Web 连接；纯 CLI profile 只有回车展开，设置页读写不可用。
- 设置页会提示文件级错误、被忽略条目以及保存/删除结果。

## 数据文件

路径：`%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`

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

- **保存**：先写临时文件再原子替换；覆盖已有文件前生成备份 `commands.json.bak-<时间戳>`；损坏文件保存时生成 `commands.json.broken-<时间戳>`。
- **读取**：文件缺失 → 空列表；无法读取 / JSON 语法错误 / 顶层格式错误 → 不加载任何命令并提示；单条非法（名称格式、内置冲突、重复、空 prompt）→ 忽略该条，其余正常加载。
- 单条上限：名称 32 字符、简述 200 字符、prompt 100000 字符。

## 卸载

```
plugin_manager remove_bundle  target: @kimiwangcoding/dsh-customized-commands
```

数据文件不会被自动删除；如需彻底清理，手动删除 `%USERPROFILE%\.dsh\dsh-customized-commands\`。

## 许可证

[MIT](LICENSE)
