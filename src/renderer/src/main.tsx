import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'antd/dist/reset.css'
import 'highlight.js/styles/github-dark.css'
import './styles/global.css'
// 在 React 挂载前完成首帧主题应用：themeStore 在模块初始化时即解析并写入
// 全部 CSS 变量与 color-scheme，因此不依赖 index.html 的内联脚本
// （内联脚本会被当前 CSP 的 script-src 'self' 拦截）。
import './stores/themeStore'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
