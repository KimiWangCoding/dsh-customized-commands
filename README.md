# dsh-customized-commands

DeepSeek Harness 插件：自定义以 `/` 开头的命令，在 prompt 中键入后于回车时展开为完整 prompt。

> **状态：S0 工程骨架**（可安装的最小版本）。命令存储、设置页 CRUD、提示框栏目与回车展开在后续子任务中实现，详见 `dsh-tasks.md`。

## 目标功能

- 在“设置 → 自定义命令”中新建、修改、删除 `/xxx` 命令。
- 键入 `/xxx` 时与内置命令一样蓝色高亮，并出现在 `/` 提示框的“自定义命令”栏目中（显示名称与简述）。
- 命令前后以空格或换行分隔；回车后由插件内部替换为命令 prompt，并在 prompt 前后各加一个换行符。
- 命令与 prompt 保存在 `%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`。
- 非法命令名（格式不符或与内置命令冲突）在设置页被拒绝；JSON 中的非法条目被忽略；JSON 损坏时不加载任何命令，并在设置页提醒。

## 兼容性

- DeepSeek Harness **0.2.2-rc.1**（已在本机核对运行时版本）。

## 开发状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0 | 工程骨架（Git、manifest、locale、icon、占位设置页、冒烟触发源） | 已完成 |
| S1 | Host 存储层与展开核心 | 已完成（待测试） |
| S2 | Host HTTP API 与发送前展开 | 已完成 |
| S3 | Client 数据层与 `/` 触发源 | 待开始 |
| S4 | 回车后替换（发送路径） | 待开始 |
| S5 | 设置页 UI | 待开始 |
| S6 | 安装与端到端验证 | 待开始 |
| S7 | 文档与收尾 | 待开始 |

## 目录结构

```
dsh-customized-commands/
├─ package.json          # npm 清单、dsh.bundle / dsh.client 声明
├─ cordis.patch.yml      # Loader 插入行
├─ index.js              # Host 半
├─ client.js             # 浏览器半（__ModuleLoader__ 工厂）
├─ lib/
│  ├─ command-store.js   # commands.json 读写、校验、备份、损坏保护
│  └─ expander.js        # /xxx 扫描与 prompt 展开（纯函数）
├─ test/                 # 单测（入口 test/all.mjs）
├─ locale/               # 插件清单文案（zh / en）
├─ icon.svg              # 插件图标
├─ dsh-tasks.md          # 任务清单与验收标准
└─ README.md
```

## 本地测试

```
node test/all.mjs
```

> 沙箱环境下不要使用 `node --test`（test runner 会 spawn 子进程并触发 EPERM）；直接运行 `test/all.mjs` 即可在进程内执行全部用例。

## 安装

安装会修改当前 DSH profile（`package.json` / `node_modules` / Loader 组合），需经明确批准后执行：

```
plugin_manager install_bundle  target: <本目录绝对路径>
```

安装完成后按返回的 `application` / `warnings` 判断是否已生效；若提示 `restart-required`，需重启 Harness。

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

- 路径：`%USERPROFILE%\.dsh\dsh-customized-commands\commands.json`
- 命令名：`^[a-z0-9][a-z0-9_-]*$`，且不得与内置命令重名。
