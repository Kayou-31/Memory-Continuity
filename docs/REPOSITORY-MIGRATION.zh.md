# GitHub 仓库迁移：Memory-Continuity

2026-10-24，仓库由 `Kayou-31/dsh-ultra-rp-memory` 更名为 **`Kayou-31/Memory-Continuity`**。

- 仓库：<https://github.com/Kayou-31/Memory-Continuity>
- 最新正式版与附件：<https://github.com/Kayou-31/Memory-Continuity/releases/latest>
- 更名时的正式版：<https://github.com/Kayou-31/Memory-Continuity/releases/tag/v0.2.0>

这是同一个仓库的改名，仓库 ID 仍为 `1427477600`。Git 历史、Issues、PR 和 Releases 随原仓库保留；没有新建同名替代仓库或迁移数据。

## 已有本地克隆

在对应 Git 仓库执行：

```sh
git remote set-url origin https://github.com/Kayou-31/Memory-Continuity.git
git remote -v
```

SSH 用户可使用 `git@github.com:Kayou-31/Memory-Continuity.git`。新的克隆命令为：

```sh
git clone https://github.com/Kayou-31/Memory-Continuity.git
```

## 旧地址和发布文件

GitHub 自动把旧仓库地址以及其 PR、Release 等路径重定向到新仓库；更早的 `Kayou-31/dsh-rp-memory` 地址也保留跳转。旧 Git clone/fetch/push 地址仍可使用，建议更新 remote。

**不要在 Kayou-31 下重新创建 `dsh-ultra-rp-memory` 或 `dsh-rp-memory` 仓库来占位**，复用旧名会破坏相应跳转。规则依据 [GitHub 官方仓库更名说明](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)。

当前 README、包元数据、仓库文档中的导航链接和 GitHub 发布说明使用新地址。历史报告中的旧名称和本地路径属于当时证据，保留原意。已发布的 TGZ、源码 ZIP、校验文件与标签不重写，因此包内历史快照可能仍含旧网址，它们通过重定向继续可用。

更名时 npm 包名为 `@dsh-external/dsh-memory-continuity`，版本为 `0.2.0`；此次更名没有修改版本。`rp-memory` 配置节点、`.dsh-rp` 数据目录、`/memcont` 主命令与 `/rp` 兼容别名均不变。更名不涉及插件运行时或用户数据迁移；后续版本和兼容范围以当前 README 为准。
