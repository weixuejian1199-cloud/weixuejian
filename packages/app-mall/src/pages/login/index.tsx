import { useState } from 'react'
import { View, Text, Button, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useUserStore } from '../../stores/user'
import './index.scss'

export default function LoginPage() {
  const [agreed, setAgreed] = useState(false)
  const { setUser } = useUserStore()

  const handleGetPhoneNumber = (e) => {
    if (!agreed) {
      Taro.showToast({ title: '请先同意用户协议', icon: 'none' })
      return
    }

    const { detail } = e
    if (detail.errMsg === 'getPhoneNumber:ok') {
      // TODO: Send detail.code to backend to decrypt phone number and login
      // Mock login success
      setUser({
        name: '小雨',
        phone: '138****8888',
        level: 'VIP',
        points: 2680,
        totalConsumption: 3680,
        isRecommender: true,
        recommenderCode: 'SX20260328001',
      })

      Taro.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => {
        Taro.navigateBack()
      }, 1000)
    } else {
      Taro.showToast({ title: '授权失败，请重试', icon: 'none' })
    }
  }

  const handlePhoneLogin = () => {
    if (!agreed) {
      Taro.showToast({ title: '请先同意用户协议', icon: 'none' })
      return
    }
    Taro.navigateTo({ url: '/pages/login-phone/index' })
  }

  const handleSkip = () => {
    Taro.navigateBack()
  }

  const toggleAgreed = () => {
    setAgreed((prev) => !prev)
  }

  return (
    <View className='login-page'>
      {/* Brand Area */}
      <View className='brand-area'>
        <View className='brand-logo'>
          <Text className='brand-logo-text'>时皙</Text>
        </View>
        <Text className='brand-name'>时皙life</Text>
        <Text className='brand-slogan'>精致每一刻，从时皙开始</Text>
      </View>

      {/* Button & Agreement Area */}
      <View className='button-area'>
        <Button
          className='btn-wechat'
          openType='getPhoneNumber'
          onGetPhoneNumber={handleGetPhoneNumber}
        >
          <Image
            className='btn-wechat-icon'
            src='data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9IiMwN0MxNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHBhdGggZD0iTTguNjkxIDIuMTg4QzMuODkxIDIuMTg4IDAgNS40NzYgMCA5LjUzYzAgMi4yMTIgMS4xNyA0LjIwMyAzLjAwMiA1LjU1YS41OS41OSAwIDAxLjIxMy42NjVsLS4zOSAxLjQ4Yy0uMDE5LjA3LS4wNDguMTQxLS4wNDguMjEzIDAgLjE2My4xMy4yOTUuMjkuMjk1YS4zMjYuMzI2IDAgMDAuMTY3LS4wNTRsMS45MDMtMS4xMTRhLjg2NC44NjQgMCAwMS43MTctLjA5OCAxMC4xNiAxMC4xNiAwIDAwMi44MzcuNDAzYy4yNzYgMCAuNTQzLS4wMjcuODExLS4wNWE2LjQyIDYuNDIgMCAwMS0uMjQ2LTEuNzU2YzAtMy44MDQgMy41ODktNi44OTQgOC4wMTgtNi44OTQuMjYyIDAgLjUxOS4wMTcuNzc2LjA0QzE3LjE0OCA0Ljc2MiAxMy4zMjQgMi4xODggOC42OTEgMi4xODh6bS0yLjYgNC40MDhjLjU4IDAgMS4wNDkuNDcgMS4wNDkgMS4wNDkgMCAuNTgtLjQ3IDEuMDQ5LTEuMDQ5IDEuMDQ5YTEuMDUgMS4wNSAwIDAxMC0yLjA5OHptNS4yMjIgMGMuNTggMCAxLjA0OS40NyAxLjA0OSAxLjA0OSAwIC41OC0uNDcgMS4wNDktMS4wNDkgMS4wNDlhMS4wNSAxLjA1IDAgMDEwLTIuMDk4ek0xNy4wNzQgOS4xN2MtMy44OSAwLTcuMDQ4IDIuNzE2LTcuMDQ4IDYuMDYzIDAgMy4zNDggMy4xNTggNi4wNjMgNy4wNDggNi4wNjMuNzcgMCAxLjUxNC0uMTA4IDIuMjI0LS4zMDhhLjY3LjY3IDAgMDEuNTU5LjA3N2wxLjQ4NC44N2EuMjU1LjI1NSAwIDAwLjEzLjA0Mi4yMjguMjI4IDAgMDAuMjI3LS4yM2MwLS4wNTYtLjAyMy0uMTEyLS4wMzgtLjE2NmwtLjMwNS0xLjE1NmEuNDYuNDYgMCAwMS4xNjYtLjUxOUMyMy4wMjUgMTguNzggMjQuMTIyIDE3LjEgMjQuMTIyIDE1LjIzM2MwLTMuMzQ3LTMuMTU4LTYuMDYzLTcuMDQ4LTYuMDYzem0tMi40NTIgMy42NzJhLjgyLjgyIDAgMTEwIDEuNjQuODIuODIgMCAwMTAtMS42NHptNC45MDcgMGEuODIuODIgMCAxMTAgMS42NC44Mi44MiAwIDAxMC0xLjY0eiIvPjwvc3ZnPg=='
            mode='aspectFit'
          />
          <Text>微信一键登录</Text>
        </Button>

        <Button className='btn-phone' onClick={handlePhoneLogin}>
          <Text>手机号登录</Text>
        </Button>

        {/* Agreement */}
        <View className='agreement' onClick={toggleAgreed}>
          <View className={`checkbox-custom ${agreed ? 'checkbox-custom--checked' : ''}`}>
            {agreed && <View className='checkbox-tick' />}
          </View>
          <Text className='agreement-text'>
            我已阅读并同意
            <Text className='agreement-link'>《用户协议》</Text>
            和
            <Text className='agreement-link'>《隐私政策》</Text>
          </Text>
        </View>
      </View>

      {/* Bottom */}
      <View className='bottom-area'>
        <Button className='skip-link' onClick={handleSkip}>
          <Text>跳过登录，随便看看</Text>
        </Button>
      </View>
    </View>
  )
}
