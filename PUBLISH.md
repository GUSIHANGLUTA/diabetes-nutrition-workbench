# 发布到 GitHub 的三种方式

> 这台机器实测：`github.com:443` **不通**（git push 走 HTTPS 会超时），但 **`api.github.com`** 与
> **`ssh.github.com:443`** 可以连通。所以下面给出三条都能走通的路，按推荐顺序排列。

仓库默认信息（可改）：

| 项 | 默认值 |
| --- | --- |
| 账号 | `gluta` |
| 仓库名 | `diabetes-nutrition-workbench` |
| 可见性 | 公开（私有则只有你自己能看到下载链接） |
| 分支 | `main` |
| 描述 | 糖尿病配餐与血糖管理工作台：输入基础数据自动生成交换份食谱（含营养素与 GI/GL、食材平替）；输入血糖与运动情况自动重算进餐时间/量/种类与运动处方。纯本地单文件网页，供营养师使用。 |

---

## 方式 A：SSH（推荐，无需在对话里传任何密钥）

SSH 走 `ssh.github.com` 的 **443 端口**，能绕过 `github.com:443` 被墙的问题。

1. 本机已生成密钥（无密码）：`~/.ssh/id_ed25519_github_dm`
2. 打开 <https://github.com/settings/ssh/new> → Title 随便填（如 `dm-workbench`）→
   Key 粘贴下面这一行 → **Add SSH key**：

   ```
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMRk1e/zYVz83hn30AYaJwhKhHCDRjv9sT/xGngEAzAw gluta@dm-workbench
   ```

3. 回到这里说一声「已添加」，我执行：

   ```powershell
   # 先在网页上新建空仓库（不要勾选 README），然后
   git remote add origin ssh://git@ssh.github.com:443/gluta/diabetes-nutrition-workbench.git
   git push -u origin main
   ```

   你也可以自己一行搞定（仓库已建好的话）：

   ```powershell
   git remote set-url origin ssh://git@ssh.github.com:443/gluta/diabetes-nutrition-workbench.git
   git push -u origin main
   ```

> 之后每次推送都只需 `git push`，因为 remote 里已经写死了 443 端口。

---

## 方式 B：Personal Access Token + REST API（不需要 git push）

适合 `github.com` 与 SSH 都不方便的环境。`tools/publish_to_github.py` 会把当前目录的文件
通过 Git Data API 写成一次提交，**全程只访问 `api.github.com`**。

1. 建 token：<https://github.com/settings/tokens>
   - **Classic token**：勾 `repo`（建仓 + 读写代码）
   - 或 **Fine-grained token**：Repository permissions 里给 `Contents: Read and write`、
     `Administration: Read and write`（用于建仓）
2. 在本目录执行：

   ```powershell
   $env:GITHUB_TOKEN = '粘贴你的 token'
   python tools/publish_to_github.py --repo diabetes-nutrition-workbench --public
   ```

   先干跑检查会传哪些文件（不写入）：

   ```powershell
   python tools/publish_to_github.py --dry-run
   ```

3. 脚本会自动：建仓 → 上传所有文件 → 建 `main` 分支 → 写描述与 topics → 打印仓库地址与单文件版下载链接。

> token 只在本机环境变量里用一次，不会写进任何文件；用完可以 `Remove-Item Env:GITHUB_TOKEN`，
> 并在 GitHub 上撤销该 token。

---

## 方式 C：网页上传（零命令行）

1. <https://github.com/new> 新建空仓库（不要勾 README / .gitignore / LICENSE）。
2. 进入仓库 → **Add file → Upload files**，把以下内容拖进去（保持目录结构）：
   `app/`、`tools/`、`docs/`、`README.md`、`LICENSE`、`.gitignore`、`.gitattributes`、
   `PUBLISH.md`、`refs/NOTES.md`、`糖尿病配餐与血糖管理.html`
3. 提交即可。**注意：`refs/` 下的第三方原始数据不要上传**（体积大、且需遵守上游授权）。

---

## 发布前须知

1. **`refs/` 不入库**：里面是《中国食物成分表》整理数据与悉尼大学 GI 库的原始文件，
   体积 2 MB 且授权归上游。程序运行不依赖它；需要时运行
   `python tools/fetch_reference_data.py` 重新拉取。仓库里只保留 `refs/NOTES.md`（来源说明）。
2. **数据授权**：`app/data-foods.js` 中的营养成分与 GI 值来自《中国食物成分表（标准版 第6版）》，
   已在 `LICENSE` 与 README 中声明来源与用途；商业使用前请取得正式授权或替换为合规数据源。
3. **医疗免责**：README 与 LICENSE 均写明「辅助计算工具，不构成诊疗意见」，
   建议仓库描述里也保留这句话。
4. 发布后可在 **Releases** 里上传 `糖尿病配餐与血糖管理.html` 作为可下载资产
   （比从仓库里点 Raw 下载更友好）；打 tag：`git tag -a v1.0.0 -m "首个可用版本" && git push origin v1.0.0`。

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `Failed to connect to github.com:443` | 本机无法直连 github.com，改用方式 A（ssh 443）或方式 B（API） |
| `Permission denied (publickey)` | 公钥还没加到 GitHub，或加到了别的账号 |
| `Support for password authentication was removed` | 不能用账号密码，必须用 token 或 SSH |
| `remote: Permission to ... denied` | token 权限不足（classic 需 `repo`）或仓库名冲突 |
| 想改成私有仓库 | 方式 B 去掉 `--public`（默认私有），或在网页 Settings → Danger Zone 改可见性 |
