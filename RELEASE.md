# npm 发布流程（@leizhuang1332/skyaxis）

适用：把本仓库的新版本发布到 npm registry。按顺序执行，每步都有核对点。

## 0. 前置状态

- 在 `main` 分支，`git status` 干净，待发版本号已在 `package.json` 中 bump 并提交。
- 版本号规则：功能切片落地 → minor（如 0.4.0）；小修 → patch（如 0.4.1）。

## 1. 确认 npm 登录态

```sh
npm whoami
```

- 有输出账号名 → 继续。
- 报 `ENEEDAUTH` → `npm login` 登录（须用对 `@leizhuang1332` scope 有发布权限的账号）。

## 2. 确认版本号未被占用

```sh
npm view @leizhuang1332/skyaxis versions
```

- npm 不允许重发同版本号。若目标版本已在列表中（如之前试发过），先把 `package.json` bump 到下一版本再走本流程。

## 3. 重建产物 + 跑测试

```sh
pnpm test && pnpm build
```

- `lib/` 里可能残留旧构建产物，发布前**必须重建**，否则发出去的是旧代码。
- 测试不过不发。

## 4. 预检发包内容

```sh
npm pack --dry-run
```

核对 Tarball 文件清单：

- `lib/**/*.js`、`*.js.map`、`*.d.ts`、`*.d.ts.map` 都在；
- `src/` 在（`exports` 里的 `./src/*` 依赖它）；
- `cordis.patch.yml` 在（缺了宿主按 `dsh.bundle.patch` 挂载会直接失败）；
- 没有多余文件，总大小合理。

## 5. 发布

```sh
npm publish
```

- `publishConfig.access: public` 已在 `package.json` 配好，不需要 `--access public`。
- 账号开了 2FA 时会要求输入 OTP。

## 6. 验证

```sh
npm view @leizhuang1332/skyaxis dist-tags
```

- 确认 `latest` 指向刚发的版本。

## 7. 打 tag 存档（建议）

```sh
git tag v<版本号> && git push origin v<版本号>
```

例：`git tag v0.4.0 && git push origin v0.4.0`。

## 发布后宿主侧升级

DSH 宿主侧重跑安装命令拉 latest，然后重启 `dsh web`：

```sh
dsh plugin --profile web add @leizhuang1332/skyaxis@latest
```

## 发布记录

| 日期 | 版本 | 备注 |
| --- | --- | --- |
| 2026-11-09 | （待填） | 流程文档建立时 0.4.0 尚未发布；发布后回填此行 |
