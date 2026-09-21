import { useEffect, useState } from 'react'
import { useUiStore } from '../../stores/uiStore'
import { IconButton } from '../ui'
import { Icon } from '../ui/icons'

/** 侧栏底部：账号标识 + 设置入口 */
export default function SidebarFooter(): JSX.Element {
  const openSettings = useUiStore((s) => s.openSettings)
  const [accountId, setAccountId] = useState('')
  const [authMode, setAuthMode] = useState<'local' | 'remote' | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkMessage, setLinkMessage] = useState('')
  useEffect(() => {
    void window.agent.auth.status().then((result) => {
      if (result.ok) {
        setAuthMode(result.data.mode)
        if (result.data.state === 'authenticated') setAccountId(result.data.userId ?? '')
      }
    })
  }, [])

  const startLink = async (): Promise<void> => {
    setLinkBusy(true)
    setLinkMessage('')
    try {
      const result = await window.agent.auth.link()
      setLinkMessage(result.ok ? '请在浏览器中完成绑定' : result.error.message)
    } catch { setLinkMessage('暂时无法启动账号绑定') }
    finally { setLinkBusy(false) }
  }

  return (
    <div className="mt-auto border-t border-border-subtle">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[14px] font-semibold text-accent-contrast">
          {authMode === 'local' ? 'L' : accountId ? accountId[0].toUpperCase() : 'A'}
        </div>
        <span className="text-[14px] text-txt-primary">
          {authMode === 'local' ? '本地工作区' : accountId ? `账号 ${accountId.slice(0, 8)}` : '当前账号'}
        </span>
        <span className="ml-auto">
          {authMode === 'remote' && <button className="mr-2 text-xs text-txt-muted hover:text-txt-primary" type="button" onClick={() => void window.agent.auth.logout()}>退出登录</button>}
          <IconButton
            icon={<Icon.Settings size={15} />}
            label="打开设置"
            onClick={openSettings}
          />
        </span>
      </div>
      {authMode === 'remote' && <div className="flex justify-end px-3 pb-2">
        <button className="text-xs text-txt-muted hover:text-txt-primary" type="button"
          onClick={() => void startLink()} disabled={linkBusy}>
          {linkBusy ? '正在打开…' : '绑定手机号 / QQ / 微信'}
        </button>
      </div>}
      {authMode === 'remote' && linkMessage && <p className="px-3 pb-2 text-xs text-txt-muted" role="status">{linkMessage}</p>}
    </div>
  )
}
