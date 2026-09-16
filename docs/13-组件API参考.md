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
| @ant-design/x | 未安装（阶段 C 再评估） |

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

---

## 4. 本项目自建组件（非 antd）

这些是本仓库自己的 API，定义即事实来源：

| 组件 | 文件 | 关键约束 |
| --- | --- | --- |
| `Button` | `components/ui/Button.tsx` | `variant: primary/default/text/danger`；默认 `htmlType="button"`；`autoInsertSpace={false}` |
| `IconButton` | `components/ui/IconButton.tsx` | 原生 button；`label` 必填并用作 aria-label 与 Tooltip；`md=32px` / `sm=28px` |
| `TextInput`/`TextArea`/`SearchInput` | `components/ui/Input.tsx` | `SearchInput.onChange` 收敛为 `(value: string) => void`；`TextArea` 同时写 `rows` 与 `autoSize` |
| `FormSection`/`SettingRow` | `components/ui/FormSection.tsx` | 窄窗口自动转纵向，不缩小字号 |
| `SegmentedControl<T>` | `components/ui/Segmented.tsx` | 泛型；`onChange` 收敛为纯值；默认 `block` |
| `SelectControl<T>` | `components/ui/Select.tsx` | 泛型；`options` 为 `{value,label,disabled?,title?}`；默认不可清空 |
| `ToggleSwitch` | `components/ui/Toggle.tsx` | `onChange` 收敛为 `(checked: boolean) => void`；`size` 仅 `small/default` |
| `TagChip` | `components/ui/Toggle.tsx` | `tone: neutral/accent/success/warning/error/info`，调用方不写 hex |
| `EmptyState`/`SkeletonLines` | `components/ui/EmptyState.tsx` | 主文案 16px / 说明 14px；不用 antd 默认插画 |

全部从 `components/ui`（barrel）导入，业务页面不直接引用 antd 组件。

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
