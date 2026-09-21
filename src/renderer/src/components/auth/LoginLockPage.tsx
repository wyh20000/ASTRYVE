import { useEffect, useState } from 'react'
import type { AuthStatus } from '@shared/types'
import { LoginScene } from './LoginScene'
import astryveIcon from '../../assets/astryve-icon.png'
import './loginLock.css'

export function LoginLockPage({ initialStatus }: { initialStatus: AuthStatus }): JSX.Element {
  const [status, setStatus] = useState(initialStatus)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (status.state !== 'waiting') return
    const interval = setInterval(() => {
      void window.agent.auth.status().then((result) => { if (result.ok) setStatus(result.data) })
    }, 2000)
    return () => clearInterval(interval)
  }, [status.state])

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.agent.auth.start()
      setStatus(result.ok ? result.data : { mode: 'remote', state: 'signedOut', message: result.error.message })
    } catch { setStatus({ mode: 'remote', state: 'signedOut', message: '暂时无法启动登录，请重试' }) }
    finally { setBusy(false) }
  }
  const cancel = async (): Promise<void> => {
    const result = await window.agent.auth.cancel()
    if (result.ok) setStatus(result.data)
  }

  return <div className="login-lock">
    <header className="login-lock-brand"><img className="login-lock-logo" src={astryveIcon} alt="" /><span>ASTRYVE</span></header>
    <main className="login-lock-main">
      <LoginScene />
      <section className="login-lock-panel-area" aria-label="登录 ASTRYVE">
        <div className="login-lock-panel">
          <h2>欢迎回来</h2>
          <p className="login-lock-subtitle">登录 ASTRYVE，继续你的工作。</p>
          <button className="login-lock-primary" type="button" onClick={() => void start()}
            disabled={busy || status.state === 'waiting' || status.state === 'unconfigured'}>
            {busy ? '正在打开…' : status.state === 'waiting' ? '等待浏览器登录…' : '开始登录'} <span>↗</span>
          </button>
          {status.state === 'waiting' && <button className="login-lock-cancel" type="button" onClick={() => void cancel()}>取消本次登录</button>}
          <p className="login-lock-message" role="status">{status.message || '将在系统浏览器中完成安全验证'}</p>
        </div>
      </section>
    </main>
    <footer className="login-lock-footer">© ASTRYVE · 2026</footer>
  </div>
}
