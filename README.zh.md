# dsh-codex-oauth

[English](README.md) | [中文](README.zh.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **bundle
插件**:把本地 **OpenAI Codex CLI** 会话(`~/.codex/auth.json`)中的凭据保持为
`CODEX_OAUTH_TOKEN`,使 `llm-pi-ai` 的 `openai-codex` 路由能用轮换中的 ChatGPT
OAuth access token 鉴权。Codex CLI 自己负责刷新该 token;本插件只监听该文件,把
当前 token 镜像进受管凭据文档,并在会话缺失、损坏或即将过期时大声告警。

## 前置要求 —— 先用 Codex CLI 登录

本插件**没有自己的 token**:它镜像本地 Codex CLI 会话的内容,所以必须先安装并
登录 CLI。

1. **安装 Codex CLI**(任意官方渠道):

   ```sh
   npm install -g @openai/codex
   # 或官方安装脚本:https://developers.openai.com/codex/cli
   ```

2. **用你的 ChatGPT 账号登录** —— OAuth 设备码流程会打开浏览器完成授权:

   ```sh
   codex login
   ```

   成功后 CLI 会写入 `~/.codex/auth.json`(含 `tokens.access_token`、JWT `exp`
   和 `last_refresh`)。插件监听该文件,**无需手动复制任何 token** —— 之后每次
   `codex login` 刷新都会被自动拾取。

3. **需要 ChatGPT Plus 或 Pro 订阅。** 该 token 是面向 ChatGPT `backend-api`
   的订阅级 OAuth 凭据;免费账号和仅有 API key 的账号没有本路由消费的 Codex 配额。

4. **与 OpenAI API key 无关。** 路由走 `https://chatgpt.com/backend-api`
   (`openai-codex-responses` 协议),不是 `api.openai.com`;带
   `api.responses.write` 的 API key 既不需要也不会被使用。

5. **账号与地区注意。** 凭据绑定 ChatGPT 账号,并受 OpenAI 关于自动化使用的条款
   约束:注意订阅 rate limit;不支持的地区会在后端以权限错误失败,而不是本地报错。

6. **token 生命周期。** CLI 约每 8 天自动刷新会话;插件在每个刷新后的监听窗口内
   跟随。万一 token 过期,插件会记录错误并指明修复方式 —— 重新执行 `codex login`。

验证会话存在(不要打印其内容):

```sh
test -f ~/.codex/auth.json && echo "Codex OAuth session present"
```

## 安装

本包是一个 **bundle**(官方 DSH 插件打包):声明了 `dsh.bundle` 并自带
`cordis.patch.yml`,装进 profile 后自动激活插件行。`lib/` 已提交到仓库,git 安装
**无需任何构建授权**。

### 从 GitHub 安装(推荐)

```sh
dsh plugin --profile web add github:knight-arturia/dsh-codex-oauth
```

出于供应链安全,建议锁定提交:

```sh
dsh plugin --profile web add github:knight-arturia/dsh-codex-oauth#<commit-sha>
```

### 从本地目录安装

```sh
git clone https://github.com/knight-arturia/dsh-codex-oauth
dsh plugin --profile web add ./dsh-codex-oauth
```

### 从 tarball 安装

```sh
cd dsh-codex-oauth && npm pack   # 产出 dsh-codex-oauth-0.1.0.tgz
dsh plugin --profile web add ./dsh-codex-oauth-0.1.0.tgz
```

### 从 npm 安装(发布后)

```sh
dsh plugin --profile web add @deepseek-ai/dsh-codex-oauth
```

### 然后配置路由(每种方式都需要)

在 `$DSH_HOME/settings.yaml` 中给 `llm-pi-ai` 加路由 —— bundle patch 无法改动
`settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    openai-codex:
      apiKeyEnv: CODEX_OAUTH_TOKEN
```

不启动即可验证层:

```sh
dsh --profile web --dump-config   # 应出现 "# == dsh-codex-oauth" 层
```

路由保留 pi-ai 目录的端点(`https://chatgpt.com/backend-api`、`openai-codex-responses`
协议)与模型(如 `gpt-5.6-luna`),无需 `baseURL`。之后在 GUI 的 Models 页选择
`openai-codex` / `gpt-5.6-luna` 新建会话即可。

## 为什么是"镜像"而不是"提供者"

凭据 seam(`ctx.credentials`)是单注册服务,第二个提供者无法在不替换
`dsh-credentials-local` 的情况下挂载。镜像进受管文档可以完整保留内置本地提供者
(env > `.credentials.yaml` > `.env` 优先级、热重载、0600 原子写入),同时消费方
适配器保持文档所述的**每请求解析**:`llm-pi-ai` 每次流式调用都重新解析
`apiKeyEnv`,所以轮换后的 token 无需重启即可生效。

## 配置

插件导出 Schemastery schema,默认值写在 schema 字段上。

| 键 | 默认值 | 含义 |
|---|---|---|
| `authFile` | `$CODEX_AUTH_FILE` 或 `~/.codex/auth.json` | Codex CLI 认证文档 |
| `watch` | `true` | 监听认证文件变化 |
| `debounceMs` | `100` | 监听写入稳定窗口(毫秒) |
| `warnSkewMinutes` | `30` | token 距 JWT `exp` 不足该分钟数时告警 |

## 行为

- 加载时与认证文件每次变化后:解析 `tokens.access_token`,解码 JWT `exp`,把
  token 写入受管凭据文档的 `CODEX_OAUTH_TOKEN`(仅在值变化时写)。
- token 过期或缺失:记录错误/警告并指明 `codex login` 修复路径,同时移除已存
  引用 —— 路由随后以 `MISSING_CREDENTIAL` 失败,而不是把死 token 发出去。
- 环境变量仍然优先:若启动环境中设置了 `CODEX_OAUTH_TOKEN`,解析返回环境值,
  镜像的 `set` 会被 seam 拒绝(被遮蔽)—— 插件记录该拒绝并保留环境值生效。

## 局限

- **本插件不做刷新** —— 它从不写 `~/.codex/auth.json`(该文件归 Codex CLI 所有)。
  token 过期且 CLI 未刷新时,请重新执行 `codex login`。
- **订阅范围**:该 token 是 ChatGPT 订阅级 OAuth 凭据;对 Codex 后端的使用受订阅
  rate limit 以及 OpenAI 关于自动化使用的条款约束。
- token 会被镜像进 `$DSH_HOME/.credentials.yaml`(0600),harness 自身的工具进程
  与其它用户文件一样可以读取它。

## 开发

```sh
npm install
npm run build   # tsc → lib/types + 扁平 ESM 入口到 lib/
```

## 许可证

[MIT](LICENSE)
