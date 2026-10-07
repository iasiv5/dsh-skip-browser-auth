# desktop 机休眠基线验证清单（dormant baseline）

> 用途：在 Windows desktop 机（desktop-only profile）验证 `@iasiv5/dsh-skip-browser-auth`
> 的 web-only 门控——desktop 上一律休眠（dormant-by-design）。本文可直接整段复制给
> 那台机器的 agent 执行；也是 docs/COMPATIBILITY.md §7.5 解冻条件③的基线形态
> （解冻时按同框架补 active 断言）。
> 背景：desktop Electron 自带 token，插件无收益；desktop 无版本审计，需要休眠护栏。

---

以下内容复制给 desktop 机的 agent：

```text
请在我这台 Windows desktop 机上验证 @iasiv5/dsh-skip-browser-auth 0.3.6 的休眠基线。
背景：该插件 0.3.6 起 web-only 门控——desktop profile（存在 @deepseek-ai/dsh-desktop-host
的环境）会自动休眠，这是设计行为，不要强行处理或改代码绕过。

1. 安装/升级（任选其一）：
   - 市场通道：装 dsh-m 后在 Web 侧栏「插件市场」搜 Skip Browser Auth 安装；
   - 命令通道（普通终端，不是 agent 沙箱）：
     dsh plugin --profile desktop add @iasiv5/dsh-skip-browser-auth@0.3.6
2. 重启 Desktop 应用（完全退出再启动，不是最小化）。
3. dormant 基线断言（逐条记录输出）：
   a. 无 token GET http://127.0.0.1:19387/ 仍返回 401
      （休眠态没有插件的信任栅栏，401 即正确——官方 BrowserAuth 在拦，勿误判为故障）；
   b. 伪造 Host 头（Host: evil.example）访问同地址仍返回 401（同上）；
   c. 进程日志/终端无 "BrowserAuth has been skipped" 横幅；
   d. DSH 桌面应用正常：Web GUI 可用、agent 会话正常、连接无异常报错。
4. 版本与安装确认：dsh plugin --profile desktop list 应显示该插件 0.3.6 且已启用
   ——注意：此命令必须在普通终端跑；agent 沙箱内会因 profile 写锁 EPERM 失败，
   属环境限制，不是插件问题。
5. 把 a-d 各项结果回报给主人；任何一项不符，直接回报现象，不要自行改代码或
   修改版本检测。
6. 回滚：desktop 机本就休眠，直接卸载即可（dsh plugin --profile desktop remove
   @iasiv5/dsh-skip-browser-auth 后重启 Desktop 应用），官方行为原样恢复。
```
