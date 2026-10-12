# FlowSketch

[English](README.en.md) | 简体中文

FlowSketch 是一个无需安装、可直接在浏览器中运行的流程图与论文插图绘制工具。它适合制作流程图、模型结构图、Token 矩阵、说明图和包含图片的技术示意图，项目文件使用可读写的 JSON 格式保存。

![FlowSketch 可绘制的模型结构图示例](assets/readme-example.png)

## 主要能力

- 基础图形、块箭头、括号、文字、LaTeX 公式、便签和图片
- 可新建、加入、退出和取消的组合管理，以及按图层顺序自动堆叠
- 直线、自动/手动折线和带平滑控制杆的曲线连接线，首尾可独立选择 5 种箭头样式
- Token 矩阵、立体层叠、图片池化上色和 RGBA/彩色/灰度通道
- 多选、对齐、均匀分布、图层排序、旋转和八方向缩放
- 120 组内置配色，可应用到全图或当前选择
- 撤销、重做、复制、粘贴、右键菜单和常用快捷键
- 原生 PPTX、SVG、PNG、JSON 导出
- 浏览器内多文件管理、拖放导入和自动保存

## 开始使用

项目没有构建步骤。用现代桌面浏览器直接打开 `index.html` 即可。

1. 从左侧选择图形、文字、公式、连接线、Token 矩阵、便签或图片；需要视觉边界时可将矩形设为虚线。
2. 在画布中拖动、缩放或旋转元素，在右侧修改尺寸、颜色、文字与样式。
3. 拖动连接线端点时会显示图形的四向吸附点；折线可增加绕行段并拖动绿色段手柄，曲线可拖动橙色控制杆。
4. 使用顶部的“导出”生成原生 PPTX、SVG 或 PNG，使用“JSON”查看或下载当前项目数据。

PPTX 会保留自定义画布尺寸和图层顺序。基础图形、文字、Token 单元格、直线/折线段和曲线会导出为可编辑的 PowerPoint 图形；图片使用图片对象，LaTeX 公式使用透明 PNG 保留显示效果。四角渐变在 PowerPoint 中没有等价的原生填充模型，因此会使用中心插值颜色导出。

项目会自动保存到当前浏览器配置文件的 IndexedDB 中。清理浏览器站点数据会删除这些本地文件，重要作品应定期导出备份。

## 公式编辑

点击左侧“公式”可插入 LaTeX 公式。编辑器提供两种方式：

- **可视化编辑**：像 Word 公式编辑器一样，直接点击公式中的虚线占位框输入；在任意占位框或光标位置继续插入分式、根式、上下标、积分、矩阵、分段函数等结构，可任意嵌套。
- **分类公式库**：提供结构、基础数学、希腊字母、关系符、运算符、集合与逻辑、箭头、微积分等分类，并可打开包含数字、符号、字母和希腊字母的完整数学键盘。
- **LaTeX 源码**：直接输入 KaTeX 支持的 LaTeX，并与可视化编辑双向切换。

编辑器会实时同步 LaTeX 并提示语法错误；双击画布中的公式可再次编辑，也可在属性面板中调整字号、颜色、尺寸、旋转和独立公式模式。公式会保存在项目 JSON 中，并参与 SVG、PNG 与复制图片导出。

## 文件与导入

点击右上角“文件”打开文件列表。新建和导入都会创建独立文件，不会覆盖已有文件；只有继续编辑当前文件时才会更新当前文件。

- 文件按修改时间从新到旧排列。
- JSON 文件可通过文件选择器或直接拖到页面中导入；多文件导出的 ZIP 也可直接拖回页面恢复。
- 图片拖到页面中会作为图片元素加入当前文件。
- 文件列表支持多选删除和导出，删除前会再次确认。
- 单个文件导出为 JSON；多个文件导出为 ZIP，压缩包内每个项目是一份独立 JSON。
- 默认在总容量达到 10 MB 或文件达到 100 个时提醒清理，这两个阈值可在文件列表中修改。

首次使用新版文件库时，旧版保存在 `localStorage` 中的项目会自动迁移为一个独立文件。

## 快捷操作

| 操作 | 快捷键或方式 |
| --- | --- |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |
| 复制 / 粘贴 | `Ctrl+C` / `Ctrl+V` |
| 创建副本 | `Ctrl+D` |
| 删除元素 | `Delete` 或 `Backspace` |
| 多选 | `Shift` + 单击，或框选 |
| 微移 / 快速移动 | 方向键 / `Shift` + 方向键 |
| 平移画布 | 按住空格拖动，或使用中键 |
| 等角度旋转 | `Shift` + 拖动旋转控制点 |
| 打开画板菜单 | 画板内右键 |

在画板内复制时，FlowSketch 会保留可继续编辑的元素数据，并尽量向系统剪贴板写入 PNG，方便粘贴到其他应用。系统图片剪贴板是否可用取决于浏览器权限和页面运行环境。

## JSON 与 AI 生成

FlowSketch 的项目 JSON 可以由人工编辑，也可以由 AI 生成。完整字段、元素类型、主题规则、连接规则和生成示例见 [draw.md](draw.md)，英文版见 [draw.en.md](draw.en.md)。

导入 JSON 时会新建文件；在“项目 JSON”窗口中点击“应用编辑内容”则会更新当前文件。

## 数据与隐私

- 编辑器本身不需要服务端，项目数据默认只保存在本机浏览器中。
- 图片会以 Data URL 写入项目 JSON，因此包含图片的文件可能较大。
- 预览远程项目或使用外部图片 URL 时，浏览器仍可能访问相应地址。
- 不同浏览器、不同浏览器配置文件和不同站点来源的本地文件库彼此独立。

## AI 助手

点击右上角 **AI**，配置 OpenAI 兼容的 Chat Completions API URL、Key 和模型名，就可以通过对话直接修改当前文件的画布。设置可折叠，支持流式回复、工具调用和按模型能力启用图片输入。API 配置仅保存在浏览器本地；请求由浏览器直连所填接口，不经网页服务器转发。AI 修改使用现有撤销和 IndexedDB 自动保存机制，切换文件会停止旧请求，预览模式保持只读。详细设置、接口要求和测试说明见 [AI.md](AI.md)。

## 许可证

本项目以 [GNU General Public License v3.0](LICENSE) 发布，附加的组件与素材说明见 [NOTICE](NOTICE)。

ZIP 导出使用 [fflate 0.8.2](https://github.com/101arrowz/fflate)，可视化公式输入使用 [MathLive 0.110.0](https://mathlive.io/)，公式排版使用 [KaTeX 0.16.22](https://katex.org/) 及其数学字体，PNG 画布渲染使用 [html2canvas 1.4.1](https://github.com/niklasvh/html2canvas)；四者均采用 MIT License，许可文本分别保存在 [assets/vendor/fflate.LICENSE](assets/vendor/fflate.LICENSE)、[assets/vendor/mathlive/LICENSE.txt](assets/vendor/mathlive/LICENSE.txt)、[assets/vendor/katex.LICENSE](assets/vendor/katex.LICENSE) 和 [assets/vendor/html2canvas.LICENSE](assets/vendor/html2canvas.LICENSE)。

界面文字使用未经修改的 HarmonyOS Sans SC Regular。该字体版权归 Huawei Device Co., Ltd. 所有，并按单独的 HarmonyOS Sans Fonts License Agreement 嵌入和随软件分发；完整许可保存在 [assets/vendor/harmonyos-sans/LICENSE.txt](assets/vendor/harmonyos-sans/LICENSE.txt)。第三方作品保留其各自许可证与版权声明。
