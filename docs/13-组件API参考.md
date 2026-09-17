# 13 · 组件 API 参考（实测记录）

> 用途：**禁止凭记忆写组件 API**。本文只记录「实际核对过」的结论，
> 每条都标注核对方式与出处，方便后续复核。
>
> 核对方式分三种，可信度不同：
> - **类型声明**：直接读本项目 `node_modules` 里的 `.d.ts` —— 最权威，与锁定版本一致；
> - **运行时实测**：在 vitest 里调用并断言，结论写进测试；
> - **官方文档**：仅作参考，官网为 SPA 抓取内容常不完整，不能单独作为依据。

当前锁定版本：

| 包 | 版本 |
| --- | --- |
| antd | 6.6.2 |
| react / react-dom | 18.3.1 |
| @ant-design/x | 2.9.0（已安装，阶段 C 使用） |

---

## 1. Ant Design 主题（`ThemeConfig`）

**出处**：`node_modules/antd/es/config-provider/context.d.ts`
**实测**：`src/renderer/src/theme/antdTheme.test.ts`

```ts
interface ThemeConfig {
  token?: Partial<AliasToken>
  components?: ComponentsConfig
  algorithm?: MappingAlgorithm | MappingAlgorithm[]
  inherit?: boolean          // @default true
  hashed?: boolean           // @default true, @since 5.0.0
  cssVar?: {                 // @since 5.12.0
    prefix?: string          // @default 'ant'
    key?: string             // react<18 需手动设置
  }
  zeroRuntime?: boolean      // @default false, @since 6.0.0
}
```

### 已踩过的坑

| 错误写法 | 正确写法 | 说明 |
| --- | --- | --- |
| `cssVar: true` | `cssVar: { prefix: 'ant' }` | **`cssVar` 是对象不是布尔值**。写 `true` 时 TypeScript 只有在类型被正确标注时才会报错 |
| `theme={{ ... } as never}` | 直接传 `ThemeConfig` | 断言会掩盖所有字段名错误。本项目已移除该断言 |

> **重要**：antd 对未知 token 字段**不报错**。实测
> `getDesignToken({ token: { colorNotARealToken: '#123456' } })` 会把该键原样保留在结果里。
> 也就是说字段名写错时 antd 静默忽略、不抛异常，
> **因此必须依赖 TypeScript 类型校验，不能靠运行时发现问题**。

### `AliasToken` 的继承链

**出处**：`node_modules/antd/es/theme/interface/`

```text
AliasToken extends MapToken extends SeedToken
```

- 颜色种子色（`colorPrimary` / `colorSuccess` / `colorBgBase` / `colorText` / `fontFamily` / `fontSize` / `borderRadius` / `controlHeight` …）来自 `seeds`；
- 语义色（`colorBgContainer` / `colorTextSecondary` / `colorBorderSecondary` …）来自 alias / maps。

**因此不能只 grep 单个 `.d.ts` 判断字段是否存在** —— 必须顺着继承链看，或者交给 TypeScript。
本项目采用后者：`toAntdTheme` 返回类型标注为 `ThemeConfig`，字段写错直接 typecheck 失败。

### 本项目确认可用的 token 字段

以下字段均已通过 `getDesignToken` 交叉验证「值与传入一致」：

`colorPrimary` `colorInfo` `colorSuccess` `colorWarning` `colorError` `colorLink`
`colorBgBase` `colorBgLayout` `colorBgContainer` `colorBgElevated` `colorBgSpotlight`
`colorText` `colorTextSecondary` `colorTextTertiary` `colorTextQuaternary` `colorTextLightSolid`
`colorBorder` `colorBorderSecondary`
`fontFamily` `fontFamilyCode` `fontSize` `fontSizeLG` `fontSizeSM`
`borderRadius` `borderRadiusLG` `borderRadiusSM`
`controlHeight` `controlHeightLG` `controlHeightSM` `wireframe`

### `getDesignToken` 的能力边界（重要，别用错）

**实测**（`src/renderer/src/theme/antdTokens.test.tsx`）：

```ts
antdTheme.getDesignToken({ components: { Segmented: { itemSelectedBg: '#123456' } } })
// → 返回扁平 AliasToken，结果里没有 `Segmented` 这个键
```

结论：

- `getDesignToken` **只计算顶层 alias token，不计算组件级 token**；
- 因此**不能用它断言组件级 token 的值**，只能断言顶层 token；
- 组件级 token 的**字段名合法性**由 TypeScript 校验（`ThemeConfig['components']`）；
- 传入不存在的组件名或 token 名，antd **不会抛错**，只会静默忽略。
  这再次说明：**必须靠类型校验，不能靠运行时**。

组件级 token 字段名出处（本地 `.d.ts`，已确认存在）：

| 组件 | token | 出处文件 |
| --- | --- | --- |
| Segmented | `itemSelectedBg` | `es/segmented/style/index.d.ts` |
| Modal | `contentBg` / `headerBg` | `es/modal/style/index.d.ts` |
| Card | `headerBg`（⚠️ **没有** `colorBgContainer`，卡片背景走全局 alias） | `es/card/style/index.d.ts` |
| Layout | `bodyBg` / `headerBg` / `siderBg` | `es/layout/style/index.d.ts` |
| Menu | `itemBg` / `itemSelectedBg` / `itemHoverBg` | `es/menu/style/index.d.ts` |

---

## 2. Button

**出处**：`node_modules/antd/es/button/button.d.ts`

```ts
type?: ButtonType            // 'primary' | 'default' | 'dashed' | 'link' | 'text'
danger?: boolean
htmlType?: ButtonHTMLType
autoInsertSpace?: boolean
```

### `autoInsertSpace`（重要）

antd 默认会在**两个汉字之间自动插入空格**，按钮文案会渲染成「保 存」。
这与设计文档 4.3「中文不使用过宽字距」冲突。

**处理**：本项目 `components/ui/Button.tsx` 显式传 `autoInsertSpace={false}`。
**验证**：`Button.test.tsx` 断言可访问名称与 `textContent` 都必须是「保存」。

---

## 2.1 Segmented

**出处**：`node_modules/antd/es/segmented/index.d.ts`

```ts
export interface SegmentedProps<ValueType = SegmentedValue> extends ... {
  options: SegmentedOptions<ValueType>   // (T | { label, value, icon?, tooltip?, disabled? })[]
  block?: boolean
  size?: SizeType
  vertical?: boolean
}
export type SegmentedValue = string | number   // 来自 @rc-component/segmented
```

- 组件是**泛型**的（`Segmented<T>`），使用时用 `Segmented<ThemeMode>` 保留值类型；
- `onChange` 的签名是 `(value: SegmentedValue) => void`，需要收敛到自己的联合类型；
- 选中项背景来自组件级 token `itemSelectedBg`（已映射为 `surface.raised`）；
- 渲染为 `role="radiogroup"`，每项是 `<label>` + `<input type="radio">`，
  因此可访问性测试应查 `radiogroup`，而不是 `tab`。

---

## 2.2 Select

**出处**：`node_modules/antd/es/select/index.d.ts`

- 泛型 `Select<T>`，`options` 接受 `{ value, label, disabled?, title? }`；
- **antd 6 的 DOM 结构与 5 不同**：不再有 `.ant-select-selector`，
  改为 `.ant-select-content`。测试中不要依赖旧类名，用 `role="combobox"` 定位。
- **禁用选项没有 `role="option"`**（实测只有可选带该 role），
  禁用项仅带 `aria-disabled="true"` 与 `.ant-select-item-option-disabled`。
  因此统计选项数量要按 DOM 结构，而不是 `getAllByRole('option')`。
- 下拉弹层默认挂到 `document.body`，测试中需用 `screen.findByRole('listbox')` 等待。

---

## 2.3 Switch

**出处**：`node_modules/antd/es/switch/index.d.ts`

```ts
export type SwitchSize = Exclude<SizeType, 'large'> | 'default'
```

- **`size` 不接受 `'large'`**（类型上直接排除）；
- 同时提供 `checked/defaultChecked` 与 `value/defaultValue` 两套受控属性名；
- `onChange` 签名为 `(checked, event) => void`，本项目收敛为 `(checked: boolean) => void`；
- 可访问性角色是 `switch`，`loading` 时带 `.ant-switch-loading` 且不可切换。

---

## 2.4 Tag

**出处**：`node_modules/antd/es/tag/index.d.ts`

```ts
color?: LiteralUnion<PresetColorType | PresetStatusColorType>
variant?: 'filled' | 'solid' | 'outlined'
```

- 颜色可用预设名（`'success'` / `'error'` / `'blue'` …）或自定义 hex。
  本项目用预设名，让 antd 生成配套的前景/边框色；
- 关闭按钮类名为 `.ant-tag-close-icon`；
- 子组件：`Tag.CheckableTag`、`Tag.CheckableTagGroup`。

---

## 2.5 Tooltip

**出处**：`node_modules/antd/es/tooltip/index.d.ts`

- `mouseEnterDelay?: number`，单位为**秒**（默认 0.1）。本项目 `IconButton` 取 0.4。
- `disabled` 状态的原生 `<button>` 不触发鼠标事件，Tooltip 不会显示；
  本项目 `IconButton` 用 `<span>` 包裹以保留提示。

---

## 2.6 Input / TextArea

**出处**：`node_modules/antd/es/input/index.d.ts`、`node_modules/antd/es/input/TextArea.d.ts`

```ts
export type { InputProps, InputRef } from './Input'
export type { TextAreaProps } from './TextArea'   // ⚠️ 未从 'antd' 根导出
```

- **`TextAreaProps` 必须从 `'antd/es/input'` 导入**，`antd` 根只导出 `InputProps`。

### `minRows` / `autoSize` 的真实行为

**出处**：`node_modules/@rc-component/input/lib/ResizableTextArea.js`

```js
const [minRows, maxRows] = React.useMemo(() => {
  if (autoSize && typeof autoSize === 'object') {
    return [autoSize.minRows, autoSize.maxRows]
  }
  ...
}, [autoSize])
```

结论：

1. `minRows` **只从 `autoSize` 对象内部读取**；
2. 顶层传 `minRows` **不生效**，且会被透传到 DOM，触发
   `React does not recognize the minRows prop on a DOM element` 告警；
3. 真正决定初始高度的是原生 `rows` 属性。

**本项目处理**：`TextArea` 同时写 `rows` 与 `autoSize`，两者取同一个值。
**验证**：`Input.test.tsx` 断言 `rows` 属性与 `minRows` 一致，且日志无该 React 告警。

> 组件测试第一次运行时，17 项里有 11 项因此失败，错误信息是
> `Name "按 钮"` —— 这是真实行为，不是测试写错。

---

## 3. Ant Design X

**版本**：`@ant-design/x@2.9.0`（已安装）

**相容性核对（安装前完成，非事后补记）**

```json
// @ant-design/x@2.9.0 的 peerDependencies（来自 npm registry）
{ "antd": "^6.1.1", "react": ">=18.0.0", "react-dom": ">=18.0.0" }
```

本项目 antd = **6.6.2**（满足 `^6.1.1`）、React = **18.3.1**（满足 `>=18`）。
因此**直接安装即可，不需要 `--legacy-peer-deps` 或 `--force`**。
实际执行 `npm install @ant-design/x@2.9.0` 输出 `found 0 vulnerabilities`。

### 根导出组件（逐一确认存在）

```
Actions  Attachments  Bubble  CodeHighlighter  Conversations  FileCard
Folder   Mermaid      Prompts Sender  SenderSwitch  Sources
Suggestion  Think  ThoughtChain  Welcome  XProvider
```

### XProvider（关键：单一主题源）

**出处**：`node_modules/@ant-design/x/es/x-provider/context.d.ts`

```ts
export interface XProviderProps
  extends XComponentsConfig,
    Omit<AntdConfigProviderProps, 'theme' | 'locale'> {
  theme?: Omit<ThemeConfig, 'components'> & {
    components?: ThemeConfig['components'] & ComponentsConfig
  }
  locale?: Locale          // ⚠️ 这是 X 自己的 xLocale，不是 antd 的 locale
}
```

**结论**：

1. `XProvider` 继承 antd 的 `ConfigProviderProps`，只把 `theme` 与 `locale` 拿出来重定义；
2. **`theme` 仍是 antd 的 `ThemeConfig`**，只是 `components` 允许额外合并 X 的组件 token。
   因此本项目可以直接把 `toAntdTheme()` 的结果传进去 —— **只有一个主题源**，
   满足设计文档 7.1「避免嵌套两个相互漂移的主题源」；
3. `locale` 必须用 X 自己的：`import zhCN from '@ant-design/x/es/locale/zh_CN'`。
   X 的根 index **不导出** locale，需从子路径引入。

**实现验证**：`node_modules/@ant-design/x/es/x-provider/index.js` 中确实
`import { ConfigProvider as AntdConfigProvider } from 'antd'` 并在内部渲染它，
其余 props 通过 `...antdConfProps` 透传。
**因此 `AntdApp.useApp()`、`componentSize` 等 antd ConfigProvider 能力都继续可用。**
（已由 `src/renderer/src/components/XProvider.test.tsx` 4 项测试锁定。）

### Bubble

**出处**：`node_modules/@ant-design/x/es/bubble/interface.d.ts`

```ts
export interface BubbleProps<ContentType extends BubbleContentType = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'content'> {
  content: ContentType
  contentRender?: (content, info) => React.ReactNode
  placement?: Placement                 // 'start' | 'end'
  variant?: 'filled' | 'outlined' | 'shadow' | 'borderless'
  loading?: boolean
  typing?: boolean | BubbleAnimationOption | ((content, info) => ...)
  header?: BubbleSlot<ContentType>
  footer?: BubbleSlot<ContentType>
  avatar?: BubbleSlot<ContentType>
  footerPlacement?: 'outer-start' | 'outer-end' | 'inner-start' | 'inner-end'
  onTypingComplete?: (content: string) => void
}
```

- 语义插槽：`root` / `content` / `body` / `header` / `footer` / `avatar` / `extra`；
- `Bubble.List` 的语义插槽额外含 `scroll` / `bubble` / `system` / `divider`。

### Conversations（阶段 C · 文档 7.4 使用）

**出处**：`node_modules/@ant-design/x/es/conversations/{index,Item,interface,GroupTitle}.d.ts`、
`.../conversations/hooks/useGroupable.js`、`.../conversations/Item.js`、`.../conversations/style/index.js`

```ts
items?: ItemType[]                       // { key, label?, group?, icon?, disabled?, ...HTMLAttributes }
activeKey?: string
onActiveChange?: (key, item?) => void
groupable?: boolean | { label?: ReactNode | ((group, {groupInfo}) => ReactNode); collapsible?: ... }
styles?: Partial<Record<'root'|'creation'|'group'|'item', CSSProperties>>
classNames?: Partial<Record<'root'|'creation'|'group'|'item', string>>
```

**实测行为（逐条都有出处，写代码前必须知道）**：

| 结论 | 出处 / 验证 |
| --- | --- |
| 行是 `<li onClick>`，**本身不可聚焦、无 role** | `Item.js:71-75`（`li` + `onClick`，无 `tabIndex`/`role`） |
| 因此要保留键盘可达，只能在 `label` 插槽里放真正的 `<button>`；点击冒泡到 `li`，由 `onActiveChange` 统一触发 | 本项目 `SessionList.tsx`；`SessionList.test.tsx` 锁定「一次点击只调用一次 select」 |
| 行内按钮若自己再调一次 `select`，会重复触发 —— **必须只依赖冒泡** | 同上 |
| 删除/确认等行内操作必须 `stopPropagation`，否则会连带切换会话 | `SessionList.test.tsx`「确认操作不会连带切换当前会话」 |
| `label` 是对象时**不会**生成 `title` 属性 | `Item.js:72`：`typeof info.label === 'object' ? undefined : ...` |
| 分组顺序 = `items` 中出现顺序（不是按名称排序） | `hooks/useGroupable.js:33-77` |
| 分组 DOM：`ul.ant-conversations > li.ant-conversations-group > (div.ant-conversations-group-title + ul.ant-conversations-list > li.ant-conversations-item)` | `index.js:163-186`、`GroupTitle.js:34-54` |
| 选中项带 `ant-conversations-item-active`，hover/选中背景都取 `colorBgTextHover` | `style/index.js:114-137` |
| 逐项的 `className` / `style` 会透传到 `li` | `index.js:129-134`（`pickAttrs(attr:true)` 的属性表含 `className`/`style`/`title`） |
| 分组折叠默认关闭（`mergeCollapsible = collapsible && enableCollapse`） | `GroupTitle.js:27` |

**本项目用法**：`items` 按 GROUP_ORDER 展开后传入，`groupable.label` 自定义分组标题，
行内容走 `label` 自定义渲染（文档 11 第 13 节明确允许「使用自定义 label/menu 渲染」），
`styles.item` 把行高压到 42px（文档 8.2 的 40~44px）。

### Think（阶段 C · 文档 7.5 使用）

**出处**：`node_modules/@ant-design/x/es/think/{Think.d.ts,Think.js}`、`.../think/style/index.js`

```ts
title?: ReactNode; icon?: ReactNode; loading?: boolean | ReactNode
expanded?: boolean; defaultExpanded?: boolean; onExpand?: (expand: boolean) => void
blink?: boolean; destroyOnHidden?: boolean      // @default true
classNames?: Partial<Record<'root'|'status'|'content', string>>
```

- 标题行是 `div.ant-think-status-wrapper` + `onClick`，**不可聚焦**；
  要键盘可操作，需在 `title` 插槽里放 `<button>`（点击冒泡触发切换）；
- `loading` 为 `true` 时渲染 `LoadingOutlined`，为节点时直接渲染该节点；
- `blink` 给标题加 `ant-think-motion-blink` 动画类；
- 内容区自带左侧 2px 竖线与 `paddingInlineStart`，收起时（`destroyOnHidden` 默认 true）整体卸载。

### Sources（阶段 C · 文档 7.5 使用）

**出处**：`node_modules/@ant-design/x/es/sources/{Sources.d.ts,Sources.js}`、`.../sources/style/index.js`

```ts
items?: { key?; title; url?; icon?; description? }[]
title?: ReactNode; inline?: boolean; expandIconPosition?: 'start' | 'end'
expanded?: boolean; defaultExpanded?: boolean; onExpand?: (expand: boolean) => void
```

- 非 inline 模式渲染 `div.ant-sources-title-wrapper`（`onClick` 折叠，同样不可聚焦）
  + `ul.ant-sources-list > li > a.ant-sources-link`，链接固定带
  `target="_blank" rel="noopener noreferrer"`（`Sources.js:80-88`）；
- **inline 模式的标题字号是 `fontSizeSM - 2`**（`style/index.js:78`）；
  本项目 `fontSizeSM = 14px`，用 inline 会得到 12px，**违反文档 4.2**，因此只用非 inline 模式。

### Sender（阶段 C · 文档 7.3 使用）

**出处**：`node_modules/@ant-design/x/es/sender/{interface.d.ts,Sender.js,SenderHeader.d.ts}`、
`.../sender/components/{TextArea.js,ActionButton.js,SendButton.js,LoadingButton/index.js}`

```ts
value?: string; defaultValue?: string
onChange?: (value: string, event?, slotConfig?, skill?) => void
onSubmit?: (message: string, slotConfig?, skill?) => void
onCancel?: VoidFunction; loading?: boolean; disabled?: boolean; readOnly?: boolean
submitType?: 'enter' | 'shiftEnter'          // @default 'enter'
onKeyDown?: (event: React.KeyboardEvent) => void | false
onPaste?: React.ClipboardEventHandler<HTMLElement>; onPasteFile?: (files: FileList) => void
header?: BaseNode | NodeRender; footer?: ...; prefix?: ...; suffix?: ...   // BaseNode 含 false
autoSize?: boolean | { minRows?: number; maxRows?: number }
styles/classNames?: Partial<Record<'root'|'prefix'|'input'|'suffix'|'footer'|'content'|'switch', ...>>
```

**三个必须知道的坑（都踩过，都有出处）**：

1. **Enter 提交只看 `onKeyDown` 的返回值**。
   `components/TextArea.js:88-111`：先调 `onKeyDown?.(e)`，只有 `eventRes === false` 才跳过提交；
   `preventDefault()` 不阻止提交。因此 `/Skill`、`@插件` 菜单里用回车选中时必须 `return false`，
   否则会在同一次回车里既选中菜单项又发送消息。
2. **`submitDisabled` 由 `SendButton` 反向同步**。
   `Sender.js:179` 初始化为 `!innerValue`，只在 `ActionButton.js:20-24` 的
   `useEffect` 里由 `action === 'onSend'` 的按钮更新。
   如果把默认操作区整个替换成自己的按钮（`suffix` 不渲染 `components.SendButton`），
   这个状态会永远停在初始值，**回车将再也不会发送**。
   本项目因此用 `suffix={false}` + `footer` 里显式渲染 `components.SendButton`，
   并把 `disabled={!canSend}` 传给它。
3. **`mergedDisabled = restProps.disabled ?? rootDisabled ?? context.onSendDisabled`**
   （`ActionButton.js:19`）。显式 `disabled` 优先级最高，
   所以「只有附件、没有文字」时也能发送（否则 `onSendDisabled = !value` 会拦住）。

其他已核对的行为：

- `onPasteFile` 只在「剪贴板没有文本且有文件」时触发，`onPaste` 总会触发
  （`TextArea.js:114-123`）→ 保留自己的 `onPaste` 即可覆盖粘贴图片/文档；
- `SenderRef`（`focus` / `inputElement` / `insert` / `clear` / `getValue`）：
  **不从包根导出**，需要 `import type { SenderRef } from '@ant-design/x/es/sender'`；
- 根节点 `.ant-sender-main` 自带 `borderColor: colorBorderInput` 与 `boxShadowTertiary`
  （`sender/style/index.js:19-32`），本项目用 `styles.root` 内联覆盖为
  `border: none / boxShadow: none / background: transparent`，
  描边、背景与 `focus-within` 焦点色留在外层容器上，避免与 CSS-in-JS 比优先级；
- `autoSize.maxRows` 以**行数**计，本项目按 22px 行高折算为 9 行（≈ 迁移前的 200px），
  并同时保留 `max-h-[200px]` 类作为硬上限。

---

## 4. 本项目自建组件（非 antd）

这些是本仓库自己的 API，定义即事实来源：

| 组件 | 文件 | 关键约束 |
| --- | --- | --- |
| `Button` | `components/ui/Button.tsx` | `variant: primary/default/text/danger`；默认 `htmlType="button"`；`autoInsertSpace={false}` |
| `IconButton` | `components/ui/IconButton.tsx` | 原生 button；`label` 必填并用作 aria-label 与 Tooltip；`md=32px` / `sm=28px`；`autoFocus` 供弹层关闭按钮使用 |
| `TextInput`/`TextArea`/`SearchInput` | `components/ui/Input.tsx` | `SearchInput.onChange` 收敛为 `(value: string) => void`；`TextArea` 同时写 `rows` 与 `autoSize`（需要手动 resize 时传 `autoSize={false}`） |
| `FormSection`/`SettingRow` | `components/ui/FormSection.tsx` | 窄窗口自动转纵向，不缩小字号 |
| `SegmentedControl<T>` | `components/ui/Segmented.tsx` | 泛型；`onChange` 收敛为纯值；默认 `block` |
| `SelectControl<T>` | `components/ui/Select.tsx` | 泛型；`options` 为 `{value,label,disabled?,title?}`；默认不可清空；`aria-label` 可被 `getByLabelText` 命中 |
| `ToggleSwitch` | `components/ui/Toggle.tsx` | `onChange` 收敛为 `(checked: boolean) => void`；`size` 仅 `small/default` |
| `Checkbox` | `components/ui/Checkbox.tsx` | `onChange` 收敛为 `(checked: boolean) => void`；`children` 即 label 文本（= 可访问名称）；**保留「点文字也能切换」** |
| `TagChip` | `components/ui/Toggle.tsx` | `tone: neutral/accent/success/warning/error/info`，调用方不写 hex |
| `EmptyState`/`SkeletonLines` | `components/ui/EmptyState.tsx` | 主文案 16px / 说明 14px；不用 antd 默认插画 |

全部从 `components/ui`（barrel）导入，业务页面不直接引用 antd 组件。

### Think 的动画与图标容器（实测）

| 结论 | 出处 / 验证 |
| --- | --- |
| `Think` 的前置图标容器是 `${prefixCls}-status-icon`，即 `.ant-think-status-icon`；传 `icon` 会替换默认图标，`loading` 为真时渲染 `LoadingOutlined` | `@ant-design/x/es/think/Think.js:100-105`（`StatusIcon`：`loading ? LoadingOutlined : icon ?? ThinkIcon`） |
| `loading` 与 `icon` **同时给**时以 `loading` 为准；不传 `loading` 才看得到默认的 `ThinkIcon` | 同上；`Blocks.tsx` 的思考过程改为只靠 CSS 旋转默认图标 |
| `loading` 接受 `ReactNode`，官方「自定义旋转图标」的写法就是传一个带动画的图标节点 | 官方文档 `demo/status.tsx`：`loading={loading ? <SyncOutlined style={{ animation: 'spin 1s linear infinite' }} /> : false}`；本项目改用 CSS 旋转默认图标（见下） |
| 折叠内容由 `CSSMotion` + antd 的 `initCollapseMotion()` 驱动，`leavedClassName` 为 `.ant-think-content-hidden`（**库并未定义这个类的样式**），且 **`destroyOnHidden` 默认 `true`**（收起动画结束后卸载 children） | `Think.js:79-83、112-125`；`es/style/motion/collapse.js` 只生成 `.ant-motion-collapse`；`antd/es/_util/motion.js:18-30` |
| **展开动画要等两帧 `requestAnimationFrame` 才生效**：`onEnterStart` 先写内联 `height: 0; opacity: 0`，切到 `scrollHeight` 发生在 STEP_ACTIVE，而 START → ACTIVE 由 `nextFrame`（两次 rAF）推进；**`motionDeadline` 兜底只在 STEP_ACTIVE 才挂**，所以这条链被打断时动画既不前进也不超时 —— 表现为「状态已展开、内容被裁成 0 高度且全透明」且**不会自愈** | `@rc-component/motion/es/hooks/useStepQueue.js:16-48`（`nextFrame` 推进队列）、`es/hooks/useStatus.js:118-133`（STEP_ACTIVE 才 `setTimeout(motionDeadline)`）、`@ant-design/x/es/_util/motion.js:4-32`。真实 Electron 窗口实测：内联样式停在 `height: 0px; opacity: 0` 1.5s 以上；本项目在 `global.css` 用 `.thinking-panel` 规则接管可见性（见下） |
| 展开是受控的：`expanded` + `onExpand` 与官方 `demo/expand.tsx`、`demo/destroyOnHidden.tsx` 写法一致（`onExpand={setExpanded}`）；**组件内部用 `useControlledState(defaultExpanded=true, expanded)`**，不传 `expanded` 时默认展开 | 官方文档 props 表；`Think.js:74-78`；`@rc-component/util/lib/hooks/useControlledState.js` |
| 状态行的箭头是 `RightOutlined rotate={isExpand ? 90 : 0}`（SVG 属性，不是 CSS 旋转），所以**状态与箭头一致就说明展开状态本身没问题**；调试「点开看不到」时要看内容区而不是箭头 | `Think.js:109-111` |
| 标题行是 `<div onClick>`，**不是** button；标题内容需自带可聚焦元素（本项目传 `<button aria-expanded>`） | `Think.js:96-99`；`Blocks.typography.test.tsx` |
| 状态行 `.ant-think-status-wrapper` 自带 `width: fit-content`，可点区域只有「图标 + 文字 + 箭头」那一小段 | `es/think/style/index.js:22-32`。曾据此猜过「点偏了」，但用户实测箭头会随点击旋转 ⇒ **可点区域不是本问题成因，`!w-full` 已回退**；若将来要整行可点，静态 CSS 需 `!important` 才能赢过运行时注入的 antd-x 样式 |
| 内容区 `.ant-think-content` 自带 `marginTop` / `paddingInlineStart: paddingSM` / `borderInlineStart: 2px solid colorBorder` —— 所以**不要绕开 `Think` 自己渲染正文**，否则要复制这些库样式 | `es/think/style/index.js:47-53`；本项目通过 `classNames.content` 追加自己的类，不替换库样式 |

阶段 E 起，思考过程的动效只保留「前置图标 360° 旋转」：
根节点加 `.thinking-streaming`，由 `global.css` 选中 `.ant-think-status-icon`
跑 `thinking-spin`。这是**全项目唯一一处依赖 antd-x 内部类名**的地方，
因此把出处写在这里，改动库版本时需要一起复核。

**展开/收起的可见性由我们接管**（`global.css`，`.thinking-panel` 由 `Blocks.tsx`
加在 `Think` 根节点上）：展开态 `height: auto !important; opacity: 1 !important;
transition: none !important`，收起态 `display: none !important`；正文本身只在
`open` 时挂载。原因是上表第二条 —— 库的折叠动画在两帧 rAF 之前会把内容裁成
0 高度，而流式期间 rAF 会被推迟，用户看到的就是「箭头转了、里面空的」。
内联样式必须用 `!important` 覆盖（同 antd 的 `.ant-input` 覆盖问题）。

**展开状态为什么放在调用方**：`Blocks` 的块列表在流式期间会被主进程整段重拼
（末尾的 activity 思考块随 `ev.content` 消失、下一轮再出现；重试/联网回退前
还会清空），`Blocks` 子树可能被卸载重建。状态留在块组件内部就会在重建时被重置，
表现为「点了没展开」。因此 key 用同类序号（`thinking-0`）而不是数组下标，
展开状态由 `Blocks` 自持、`MessageItem` 再往上一层持有（受控）。

### 阶段 D 实测补充

| 结论 | 出处 / 验证 |
| --- | --- |
| `IconButton` 的 `autoFocus` 会原样落到原生 button，SSR 输出 `autofocus=""` | `IconButton.test.tsx`「autoFocus 让弹层关闭按钮在挂载后立即获得焦点」；`SettingsPage.test.tsx` 断言 `autofocus=""` |
| `Button variant="danger"` 生成 `ant-btn-dangerous`（doc 8.7 要求危险操作有独立语义） | `antd/es/button/button.js:227`（`[`${prefixCls}-dangerous`]: danger`）；`SettingsPage.interaction.test.tsx` 锁定 |
| `SelectControl` 的 `aria-label` 落在可查询的位置，`getByLabelText('绑定已有连接')` / `getByLabelText('筛选 Skill 来源')` 均可用 | `Select.test.tsx`「透传 aria-label」；`SettingsPage.interaction.test.tsx` |
| antd 6 的 `Input` 默认 `width: 100%`，需要固定宽度时用外层容器（如 `<div className="sm:w-40">`），不要把 `w-*` 写在组件 `className` 上 —— 运行时注入的 antd 样式晚于静态 CSS，同权重下会赢 | 阶段 D 迁移结论；`SettingsPage.tsx` 市场源表单 |
| `Button size="sm"` = antd `small`（24px 高），用于列表行内操作；`variant="text"` 作低强调行内操作，`variant="danger"` 作不可撤销操作 | `components/ui/Button.tsx` 的 `size` → antd `size` 直传；`SettingsPage.interaction.test.tsx`、`ApprovalDialog.interaction.test.tsx` |
| `Button` 支持 `icon`，且**有 `icon` 时仍会渲染 children** —— 图标按钮必须同时给文案，否则按钮没有可访问名称 | `SettingsPage.tsx` 技能市场行：迁移前「已安装」是纯 `<Icon.Check>` 的无名按钮，迁移后为「已添加」+ 勾 |

**测试写法上的两个坑（阶段 D 续）**

| 现象 | 处理 |
| --- | --- |
| `<summary>` 也会被 `getByRole('button')` 命中，因此 `getByRole('button', { name: '添加' })` 会同时命中 `<summary>添加</summary>` 与真正的按钮 | 用 `within(区块)` 限定查询范围；不要靠 `getAllByRole(...)[n]` 顺序 |
| 断言「IPC 失败前不会清理」时，mock 的 Promise 在同一 microtask 内 resolve，点击后立即断言必然失败 | 让 mock 返回失败结果，等错误文案出现后再断言回调未被调用 |
| antd 的禁用 Checkbox/Switch 带 `pointer-events: none`，`userEvent.click` 会直接报错「element has pointer-events: none」 | 断言 `toBeDisabled()` 后用 `userEvent.click(el, { pointerEventsCheck: 0 })` 验证「点了也不回调」 |

**组件设计决策记录（本轮）**

- **审批弹层页脚只保留一个主操作**：范围按钮（本任务允许 / 始终允许 / 仅批准本次）
  原本用三种边框底色区分，但语义上没有主次，统一为 `default`，
  只有「仅批准本次」是 `primary`。
- **为什么必须自建 `Checkbox` 而不是直接用 `ToggleSwitch`**：
  antd `Switch` 渲染的是 `<button>`，`<label>` 不会把点击转发给它；
  而原生 `<input type="checkbox">` 在 `<label>` 里天然支持「点文字也能切换」。
  antd `Checkbox` 的结构是 `label > (input + span.ant-checkbox-label)`
  （`antd/es/checkbox/Checkbox.js:131、149`），点击 label 文本会经原生
  label→input 关联触发 onChange，**能力零损失**。因此复选框族用 `Checkbox`，
  开关族（无绑定文字、只有 `aria-label`）用 `ToggleSwitch`。
- **`title` 的位置**：Checkbox 会把 `title` 透传到内部的 `<input>`，
  只悬停文字不会出提示，所以设置页把 `title` 挂在外层 `<span>` 上。

---

## 5. 复核方法

```bash
# 1. 类型层面的字段校验（最权威）
npm run typecheck

# 2. 主题字段是否真的被 antd 采纳
npx vitest run src/renderer/src/theme/antdTheme.test.ts

# 3. 组件交互与语义
npx vitest run src/renderer/src/components/ui
```

新增任何 antd 组件用法时，请：

1. 先读 `node_modules/antd/es/<component>/index.d.ts` 确认真实签名；
2. 在本文档补一条记录（字段、默认值、出处）；
3. 若要依赖某条行为，为其补一个测试，别只写注释。
