import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useState } from 'react'
import './index.scss'

const MOCK_WITHDRAWABLE = 580.00
const SERVICE_FEE_RATE = 0.02

export default function WithdrawPage() {
  const [amount, setAmount] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [countdown, setCountdown] = useState(0)

  const numAmount = parseFloat(amount) || 0
  const serviceFee = (numAmount * SERVICE_FEE_RATE).toFixed(2)
  const actualAmount = (numAmount * (1 - SERVICE_FEE_RATE)).toFixed(2)
  const canSubmit = numAmount > 0 && numAmount <= MOCK_WITHDRAWABLE && verifyCode.length === 6

  const handleAllIn = () => {
    setAmount(MOCK_WITHDRAWABLE.toFixed(2))
  }

  const handleSendCode = () => {
    if (countdown > 0) return
    Taro.showToast({ title: '验证码已发送', icon: 'none' })
    setCountdown(60)
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    Taro.showModal({
      title: '确认提现',
      content: `提现 ¥${numAmount.toFixed(2)}，扣除服务费 ¥${serviceFee}，实际到账 ¥${actualAmount}`,
      confirmText: '确认',
      confirmColor: '#C9A96E',
      success(res) {
        if (res.confirm) {
          Taro.showToast({ title: '提现申请已提交', icon: 'success' })
          setTimeout(() => {
            Taro.navigateBack()
          }, 1500)
        }
      },
    })
  }

  return (
    <View className='withdraw-page'>
      {/* Available Balance */}
      <View className='balance-card'>
        <Text className='balance-label'>可提现金额（元）</Text>
        <Text className='balance-value'>¥{MOCK_WITHDRAWABLE.toFixed(2)}</Text>
      </View>

      {/* Amount Input */}
      <View className='input-card'>
        <Text className='input-title'>提现金额</Text>
        <View className='amount-row'>
          <Text className='amount-prefix'>¥</Text>
          <Input
            className='amount-input'
            type='digit'
            placeholder='请输入提现金额'
            value={amount}
            onInput={(e) => setAmount(e.detail.value)}
          />
          <Text className='amount-all' onClick={handleAllIn}>全部提现</Text>
        </View>
        {numAmount > MOCK_WITHDRAWABLE && (
          <Text className='amount-error'>超出可提现金额</Text>
        )}
      </View>

      {/* Payment Method */}
      <View className='method-card'>
        <Text className='method-title'>到账方式</Text>
        <View className='method-row'>
          <Text className='method-icon'>{'\uD83D\uDCB3'}</Text>
          <Text className='method-name'>微信零钱</Text>
          <Text className='method-check'>{'\u2705'}</Text>
        </View>
      </View>

      {/* Service Fee */}
      <View className='fee-card'>
        <View className='fee-row'>
          <Text className='fee-label'>服务费（2%）</Text>
          <Text className='fee-value'>-¥{numAmount > 0 ? serviceFee : '0.00'}</Text>
        </View>
        <View className='fee-divider' />
        <View className='fee-row'>
          <Text className='fee-label'>实际到账</Text>
          <Text className='fee-value fee-value--gold'>
            ¥{numAmount > 0 ? actualAmount : '0.00'}
          </Text>
        </View>
      </View>

      {/* Phone Verify */}
      <View className='verify-card'>
        <Text className='verify-title'>手机验证</Text>
        <View className='verify-row'>
          <Input
            className='verify-input'
            type='number'
            maxlength={6}
            placeholder='请输入验证码'
            value={verifyCode}
            onInput={(e) => setVerifyCode(e.detail.value)}
          />
          <View
            className={`verify-btn ${countdown > 0 ? 'verify-btn--disabled' : ''}`}
            onClick={handleSendCode}
          >
            <Text className='verify-btn-text'>
              {countdown > 0 ? `${countdown}s` : '获取验证码'}
            </Text>
          </View>
        </View>
        <Text className='verify-hint'>验证码将发送至 138****8888</Text>
      </View>

      {/* Submit */}
      <View
        className={`submit-btn ${canSubmit ? 'submit-btn--active' : ''}`}
        onClick={handleSubmit}
      >
        <Text className='submit-btn-text'>确认提现</Text>
      </View>
    </View>
  )
}
