/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* 语义表面令牌：与新设计系统一一对应 */
        surface: {
          app: 'var(--surface-app)',
          sidebar: 'var(--surface-sidebar)',
          panel: 'var(--surface-panel)',
          raised: 'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
          hover: 'var(--surface-hover)',
          active: 'var(--surface-active)'
        },
        /* 旧命名保留，继续指向同一批令牌，避免未迁移页面外观回归 */
        bg: {
          app: 'var(--surface-app)',
          panel: 'var(--surface-sidebar)',
          raised: 'var(--surface-raised)',
          active: 'var(--surface-active)'
        },
        border: {
          DEFAULT: 'var(--border-default)',
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)'
        },
        txt: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
          link: 'var(--text-link)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          active: 'var(--accent-active)',
          soft: 'var(--accent-soft)',
          contrast: 'var(--accent-contrast-text)',
          /* @deprecated 旧别名 */
          dim: 'var(--accent-soft)'
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          error: 'var(--status-error)',
          info: 'var(--status-info)'
        },
        /* 旧状态色命名保留 */
        ok: 'var(--status-success)',
        warn: 'var(--status-warning)',
        err: 'var(--status-error)',
        code: {
          editor: 'var(--code-editor)',
          inline: 'var(--code-inline)',
          block: 'var(--code-block)'
        }
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)']
      },
      /* 字号层级：正文 14 / 分区标题 16 / 页面标题 20 / 强识别 24 */
      fontSize: {
        xs: ['var(--font-size-base)', 'var(--line-height-base)'],
        sm: ['var(--font-size-base)', 'var(--line-height-base)'],
        base: ['var(--font-size-base)', 'var(--line-height-base)'],
        section: ['16px', '24px'],
        page: ['20px', '28px'],
        hero: ['24px', '32px']
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        bubble: 'var(--radius-bubble)',
        full: 'var(--radius-full)'
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
        modal: 'var(--shadow-modal)',
        raised: 'var(--shadow-raised)'
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        DEFAULT: 'var(--motion-base)',
        slow: 'var(--motion-slow)'
      },
      transitionTimingFunction: {
        DEFAULT: 'var(--motion-ease)'
      }
    }
  },
  plugins: []
}
