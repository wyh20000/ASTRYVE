/**
 * 令牌 → Ant Design 主题映射。
 *
 * 关键设计决定：返回值类型标注为 antd 的 `ThemeConfig`，而不是宽松的
 * `Record<string, unknown>`。
 *
 * 原因：此前用 `Record<string, unknown>` + 调用处 `as never` 的写法，
 * 让 TypeScript 完全无法校验主题字段，结果把 `cssVar` 写成了布尔值
 * （antd 6 中它是对象 `{ prefix?, key? }`）也没有任何报错。
 * 标注真实类型后，任何字段名或类型错误都会在 typecheck 阶段暴露。
 *
 * 字段依据（均为本地 antd 6.6.2 类型声明的实测结果，非记忆）：
 * - `ThemeConfig`：`node_modules/antd/es/config-provider/context.d.ts`
 *   → `token` / `components` / `algorithm` / `inherit` / `hashed` / `cssVar` / `zeroRuntime`
 * - `AliasToken`：`node_modules/antd/es/theme/interface/alias.d.ts`
 *   继承 `MapToken` → `SeedToken`，颜色种子色（colorPrimary 等）来自 seeds。
 */
import type { ThemeConfig } from 'antd'
import type { ThemeMode } from '@shared/themePreferences'
import type { ResolvedTheme } from './tokens'

export function toAntdTheme(theme: ResolvedTheme, mode: ThemeMode): ThemeConfig {
  const { color, font, radius, space, shadow } = theme
  void mode

  return {
    /*
     * CSS 变量模式：antd 6 中 `cssVar` 是对象而不是布尔值。
     * 开启后组件样式引用 CSS 变量，主题切换只改变量、不重新生成样式表。
     * key 用于多主题场景；本项目单主题，交给 antd 依据 token 自动生成。
     */
    cssVar: { prefix: 'ant' },
    /*
     * 应用内只存在一个 antd 版本，关闭 hashed 可以减小样式体积。
     * 见 ThemeConfig.hashed 的 @descCN 说明。
     */
    hashed: false,
    token: {
      colorPrimary: color.accent.primary,
      colorInfo: color.status.info,
      colorSuccess: color.status.success,
      colorWarning: color.status.warning,
      colorError: color.status.error,
      colorLink: color.text.link,

      colorBgBase: color.surface.app,
      colorBgLayout: color.surface.app,
      colorBgContainer: color.surface.raised,
      colorBgElevated: color.surface.overlay,
      colorBgSpotlight: color.surface.overlay,

      colorText: color.text.primary,
      colorTextSecondary: color.text.secondary,
      colorTextTertiary: color.text.muted,
      colorTextQuaternary: color.text.muted,
      colorTextLightSolid: color.accent.contrastText,

      /*
       * Ant Design X 的 Bubble `variant="filled"` 使用 colorFillContent
       * （见 @ant-design/x/es/bubble/style/content.js）。antd 默认值是
       * 面向浅色表面的黑色叠加层，在深色背景下几乎不可见。
       * 这里改为本项目的表面悬浮层，保证两种模式都有清晰的气泡底。
       */
      colorFillContent: color.surface.active,

      /*
       * 按钮的「下沉阴影」：antd 6 用 controlOutline 作为实心阴影色
       * （button/style/token.js: primaryShadow = `0 2px 0 <controlOutline>`）。
       * 默认值在深色主题下呈现为近白的 rgb(240,245,255)，
       * 会在按钮下方形成一条白边。指向应用背景色即可让它融入背景。
       */
      controlOutline: color.surface.app,
      controlOutlineWidth: 2,

      /* 其余浮层阴影同样按明暗派生，避免深色下偏浅 */
      boxShadow: shadow.raised,
      boxShadowSecondary: shadow.overlay,
      boxShadowTertiary: shadow.raised,

      colorBorder: color.border.default,
      colorBorderSecondary: color.border.subtle,

      fontFamily: font.sans,
      fontFamilyCode: font.mono,
      fontSize: font.size.body,
      fontSizeLG: font.size.section,
      fontSizeSM: font.size.body,

      borderRadius: radius.md,
      borderRadiusLG: radius.lg,
      borderRadiusSM: radius.sm,
      controlHeight: space.control,
      controlHeightLG: 36,
      controlHeightSM: 28,
      wireframe: false
    },
    components: {
      Layout: {
        bodyBg: color.surface.app,
        headerBg: color.surface.sidebar,
        siderBg: color.surface.sidebar
      },
      Menu: {
        itemBg: 'transparent',
        itemSelectedBg: color.surface.active,
        itemHoverBg: color.surface.hover
      },
      Modal: { contentBg: color.surface.overlay, headerBg: color.surface.overlay },
      /*
       * Card 在 antd 6 没有 colorBgContainer 这个组件级 token
       * （其组件 token 只有 headerBg / headerFontSize / bodyPadding 等）。
       * 卡片背景走全局 alias colorBgContainer，已在上方统一为 surface.raised，
       * 因此这里不再重复覆盖，避免写出一个实际不存在的字段。
       */
      Segmented: { itemSelectedBg: color.surface.raised }
    }
  }
}
