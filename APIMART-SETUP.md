# 使用 APImart 生成 Board 图标

1. 重启 Obsidian，使插件 0.1.25 更新生效。
2. 在新建 Board 窗口选择「AI 生成」，打开「配置图像服务」。
3. 「生图服务」选择 APImart，自动填写下列参数：

| 配置 | 填写内容 |
| --- | --- |
| 服务地址 | `https://api.apimart.ai/v1` |
| 模型 | `gpt-4o-image` |
| API Key | 自己在 [APImart API Keys](https://apimart.ai/keys) 创建的密钥 |

4. 点击「保存本次配置」，再点击「生成预览」。成功后创建 Board。

名称与配色用于生成统一风格的文件夹图标。文章正文不会进入生图请求。密钥仅保留在当前画板会话，关闭/刷新后需重新输入；已经保存的图标离线可用。每次主动生成按 APImart 模型计费，缓存预览可直接用于创建。

本次预设依据 GPT-4o Image 文档；其他模型的名称和额外参数以各自 APImart 文档为准。该接口没有单独发送透明背景参数，提示词会请求透明背景，无法保证模型实际输出 alpha 通道。

## 插件处理流程

- `POST https://api.apimart.ai/v1/images/generations`：Bearer API Key；请求模型、提示词、`n: 1`、`size: "1:1"`。
- 响应中的 `data[0].task_id` 用于查询 `GET /v1/tasks/{task_id}?language=zh`。
- 任务为 `pending`/`processing` 时继续等待；`completed` 时读取 `data.result.images[0].url[0]`。
- 下载图片到知识库附件目录，之后 Board 引用本地图片。图片下载不会转发 API Key。
- 图像提交不会自动重复，以免创建重复任务。总等待 8 分钟，失败与超时不会写入错误图片。

APImart 文档说明生成图片链接有效期 24 小时，所以插件在任务完成后立即下载本地保存。

来源：[GPT-4o Image 图像生成](https://docs.apimart.ai/cn/api-reference/images/gpt-4o/generation)、[任务状态查询](https://docs.apimart.ai/en/api-reference/tasks/status)。

验证：已通过模拟服务协议与配置界面检查；尚未使用真实 APImart 密钥调用付费生成。
