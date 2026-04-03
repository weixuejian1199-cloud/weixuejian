import { useState } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './index.scss'

const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日']
const POINTS_SCHEDULE = [10, 15, 20, 30, 40, 50, 70]

interface CalendarDay {
  status: 'checked' | 'today' | 'upcoming' | 'surprise'
  points: number
}

const INITIAL_CALENDAR: CalendarDay[] = [
  { status: 'checked', points: 10 },
  { status: 'checked', points: 15 },
  { status: 'checked', points: 20 },
  { status: 'today', points: 30 },
  { status: 'upcoming', points: 40 },
  { status: 'upcoming', points: 50 },
  { status: 'surprise', points: 70 },
]

const TASKS = [
  { icon: '\uD83D\uDC41', name: '浏览3个商品', desc: '已浏览 1/3', reward: 10, done: false, btnText: '去完成' },
  { icon: '\uD83D\uDCAC', name: '分享1件好物', desc: '分享商品给微信好友', reward: 20, done: false, btnText: '去分享' },
  { icon: '\u2B50', name: '写1条评价', desc: '已完成', reward: 15, done: true, btnText: '已完成' },
]

const USAGE_ITEMS = [
  { icon: '\uD83C\uDF81', label: '积分试用', desc: '免费体验新品' },
  { icon: '\uD83D\uDED2', label: '积分换购', desc: '低价换好物' },
  { icon: '\uD83D\uDCB2', label: '积分抵现', desc: '100积分抵1元' },
]

export default function CheckinPage() {
  const [isCheckedIn, setIsCheckedIn] = useState(false)
  const [streakDays, setStreakDays] = useState(3)
  const [totalPoints, setTotalPoints] = useState(2680)
  const [calendar, setCalendar] = useState<CalendarDay[]>(INITIAL_CALENDAR)

  const todayPoints = POINTS_SCHEDULE[streakDays] || 30

  const handleCheckin = () => {
    if (isCheckedIn) return
    setIsCheckedIn(true)
    setStreakDays((prev) => prev + 1)
    setTotalPoints((prev) => prev + todayPoints)
    setCalendar((prev) =>
      prev.map((day, idx) =>
        idx === streakDays ? { ...day, status: 'checked' as const } : day
      )
    )
    Taro.showToast({ title: `签到成功 +${todayPoints}积分`, icon: 'none' })
  }

  const handleGoPoints = () => {
    Taro.navigateTo({ url: '/pages/member/points/index' })
  }

  return (
    <View className='checkin'>
      {/* Streak Header */}
      <View className='checkin__streak'>
        <Text className='checkin__streak-label'>已连续签到</Text>
        <View className='checkin__streak-row'>
          <Text className='checkin__streak-number'>{isCheckedIn ? streakDays : streakDays}</Text>
          <Text className='checkin__streak-unit'>天</Text>
        </View>
        <Text className='checkin__streak-vip'>VIP会员 积分加成 1.5x</Text>
      </View>

      {/* Calendar */}
      <View className='checkin__calendar'>
        <Text className='checkin__calendar-title'>本周签到</Text>
        <View className='checkin__calendar-labels'>
          {WEEK_DAYS.map((d) => (
            <Text key={d} className='checkin__calendar-label'>{d}</Text>
          ))}
        </View>
        <View className='checkin__calendar-days'>
          {calendar.map((day, idx) => (
            <View key={idx} className={`checkin__calendar-day checkin__calendar-day--${day.status}`}>
              {day.status === 'checked' ? (
                <Text className='checkin__calendar-check'>{'\u2713'}</Text>
              ) : day.status === 'surprise' ? (
                <Text className='checkin__calendar-num'>{'\uD83C\uDF1F'}</Text>
              ) : (
                <Text className='checkin__calendar-num'>{idx + 1}</Text>
              )}
              <Text className='checkin__calendar-pts'>+{day.points}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Sign Button */}
      <View className='checkin__btn-wrap'>
        <View
          className={`checkin__btn ${isCheckedIn ? 'checkin__btn--done' : ''}`}
          onClick={handleCheckin}
        >
          <Text className='checkin__btn-text'>
            {isCheckedIn ? '已签到' : `立即签到 +${todayPoints}积分`}
          </Text>
        </View>
        <Text className='checkin__btn-hint'>连续签到7天可获得惊喜奖励 +70积分</Text>
      </View>

      {/* My Points */}
      <View className='checkin__points' onClick={handleGoPoints}>
        <View className='checkin__points-left'>
          <Text className='checkin__points-label'>我的积分</Text>
          <Text className='checkin__points-value'>{totalPoints.toLocaleString()}</Text>
        </View>
        <Text className='checkin__points-detail'>积分明细 &gt;</Text>
      </View>

      {/* Tasks */}
      <View className='checkin__tasks'>
        <Text className='checkin__tasks-title'>今日品质任务</Text>
        {TASKS.map((task) => (
          <View key={task.name} className='checkin__task'>
            <View className='checkin__task-left'>
              <Text className='checkin__task-icon'>{task.icon}</Text>
              <View className='checkin__task-info'>
                <Text className='checkin__task-name'>{task.name}</Text>
                <Text className='checkin__task-desc'>{task.desc}</Text>
              </View>
            </View>
            <View className='checkin__task-right'>
              <Text className={`checkin__task-reward ${task.done ? 'checkin__task-reward--done' : ''}`}>
                +{task.reward}{task.done ? ' \u2713' : ''}
              </Text>
              <View className={`checkin__task-btn ${task.done ? 'checkin__task-btn--done' : ''}`}>
                <Text className='checkin__task-btn-text'>{task.btnText}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>

      {/* Usage */}
      <View className='checkin__usage'>
        <Text className='checkin__usage-title'>积分去处</Text>
        <View className='checkin__usage-grid'>
          {USAGE_ITEMS.map((item) => (
            <View key={item.label} className='checkin__usage-item'>
              <Text className='checkin__usage-icon'>{item.icon}</Text>
              <Text className='checkin__usage-label'>{item.label}</Text>
              <Text className='checkin__usage-desc'>{item.desc}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}
