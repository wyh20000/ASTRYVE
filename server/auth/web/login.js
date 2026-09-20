const root = document.getElementById('login-root')
const requestId = root.dataset.requestId
const csrf = root.dataset.csrf
const status = document.getElementById('status')
const phone = document.getElementById('phone')
const code = document.getElementById('code')
const send = document.getElementById('send-code')
const submit = document.getElementById('submit-login')
const qq = document.getElementById('qq')
const wechat = document.getElementById('wechat')
let countdown

function show(message, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}

async function post(path, body) {
  const result = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ ...body, requestId })
  })
  const payload = await result.json()
  if (!result.ok) throw new Error(payload.error || '请求失败，请稍后重试')
  return payload
}

function normalizedPhone() {
  const digits = phone.value.replace(/[\s-]/g, '')
  if (!/^1[3-9]\d{9}$/.test(digits)) throw new Error('请输入正确的中国大陆手机号')
  return `+86${digits}`
}

send.addEventListener('click', async () => {
  try {
    send.disabled = true
    show('正在发送验证码…')
    await post('/v1/auth/sms/request', { phone: normalizedPhone() })
    let remaining = 60
    send.textContent = `${remaining} 秒后重试`
    countdown = setInterval(() => {
      remaining--
      send.textContent = remaining > 0 ? `${remaining} 秒后重试` : '获取验证码'
      if (remaining <= 0) { clearInterval(countdown); send.disabled = false }
    }, 1000)
    show('验证码已发送，请查看短信')
  } catch (error) { show(error.message, true); send.disabled = false }
})

document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    submit.disabled = true
    show('正在验证…')
    const payload = await post('/v1/auth/sms/verify', { phone: normalizedPhone(), code: code.value })
    show('验证成功，正在返回客户端…')
    window.location.replace(payload.redirectUrl)
  } catch (error) { show(error.message, true); submit.disabled = false }
})

for (const [button, provider] of [[qq, 'qq'], [wechat, 'wechat']]) {
  button.addEventListener('click', async () => {
    try {
      button.disabled = true
      show('正在前往授权页面…')
      const payload = await post('/v1/auth/oauth/start', { provider })
      const target = new URL(payload.authorizeUrl)
      const expected = provider === 'qq' ? 'https://graph.qq.com' : 'https://open.weixin.qq.com'
      if (target.origin !== expected) throw new Error('授权地址无效')
      window.location.assign(target.toString())
    } catch (error) { show(error.message, true); button.disabled = false }
  })
}

fetch('/v1/auth/methods', { cache: 'no-store' }).then((result) => result.json()).then((methods) => {
  send.disabled = !methods.phone
  submit.disabled = !methods.phone
  qq.disabled = !methods.qq
  wechat.disabled = !methods.wechat
  if (!methods.phone && !methods.qq && !methods.wechat) show('登录方式尚未配置，请稍后再试', true)
}).catch(() => show('认证服务暂时不可用', true))
