'use client'

import { useState, useEffect, useCallback, useId, useRef } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { Place, Day } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { formatDayDate } from '@/lib/format'
import { generateKeyBetween } from 'fractional-indexing'

interface Props {
  place: Place
  days?: Day[]
  onClose: () => void
  onSave: () => void
}

/* ── 포커스 트랩용 선택자 ── */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function EditPlaceModal({ place, days, onClose, onSave }: Props) {
  const t = useTranslations('trip.editPlace')
  const tCommon = useTranslations('common')
  const format = useFormatter()

  const [name, setName] = useState(place.name)
  const [visitTime, setVisitTime] = useState(place.visit_time?.slice(0, 5) ?? '')
  const [memo, setMemo] = useState(place.memo ?? '')
  const [selectedDayId, setSelectedDayId] = useState(place.day_id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [keyboardHeight, setKeyboardHeight] = useState(0)

  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const trimmedName = name.trim()
  const canSave = trimmedName.length > 0 && !saving

  const dirty =
    trimmedName !== place.name.trim() ||
    visitTime !== (place.visit_time?.slice(0, 5) ?? '') ||
    memo !== (place.memo ?? '') ||
    selectedDayId !== place.day_id

  /* ── 닫기 요청 ── */
  // 배경 탭으로 닫는 시트 제스처는 모바일에서 기대되는 동작이라 유지하되,
  // 저장 중에는 무시하고, 수정 중인 내용이 있으면 확인을 받는다.
  const requestClose = useCallback(() => {
    if (saving) return
    if (dirty && !window.confirm(t('discardConfirm'))) return
    onClose()
  }, [saving, dirty, onClose, t])

  /* ── 키보드 높이 보정 (iOS 는 resize 뿐 아니라 scroll 로도 offset 이 바뀐다) ── */
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    function handleViewportChange() {
      const kbHeight = window.innerHeight - vv!.height - vv!.offsetTop
      setKeyboardHeight(kbHeight > 0 ? kbHeight : 0)
    }

    // 최초 1회 측정 — effect 본문에서 동기 setState 하지 않도록 다음 프레임에 실행한다.
    const rafId = window.requestAnimationFrame(handleViewportChange)
    vv.addEventListener('resize', handleViewportChange)
    vv.addEventListener('scroll', handleViewportChange)

    return () => {
      window.cancelAnimationFrame(rafId)
      vv.removeEventListener('resize', handleViewportChange)
      vv.removeEventListener('scroll', handleViewportChange)
    }
  }, [])

  /* ── 배경 스크롤 잠금 ── */
  useEffect(() => {
    const body = document.body
    const prevOverflow = body.style.overflow
    const prevOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'contain'

    return () => {
      body.style.overflow = prevOverflow
      body.style.overscrollBehavior = prevOverscroll
    }
  }, [])

  /* ── 열릴 때 포커스 이동, 닫힐 때 복원 ── */
  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    // 입력창이 아니라 시트 자체에 포커스를 준다 (모바일 키보드가 바로 뜨지 않도록).
    dialogRef.current?.focus({ preventScroll: true })

    return () => {
      previouslyFocused?.focus({ preventScroll: true })
    }
  }, [])

  /* ── Escape 로 닫기 + 간단한 포커스 트랩 ── */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key !== 'Tab') return

      const root = dialogRef.current
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === first || !(active instanceof Node) || !root.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !(active instanceof Node) || !root.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [requestClose])

  const supabase = createClient()
  const dayChanged = selectedDayId !== place.day_id

  async function handleSave() {
    if (!trimmedName) {
      setError(t('nameRequired'))
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (dayChanged) {
        // 새 Day의 마지막 order_key 조회
        const { data: lastPlaces, error: lookupError } = await supabase
          .from('places')
          .select('order_key')
          .eq('day_id', selectedDayId)
          .order('order_key', { ascending: false })
          .limit(1)

        if (lookupError) throw lookupError

        const lastKey = lastPlaces?.[0]?.order_key ?? null
        // lastKey 가 손상됐거나 그 사이 다른 사용자가 더 뒤에 넣었다면 여기서 throw 된다.
        const newKey = generateKeyBetween(lastKey, null)

        const { error: updateError } = await supabase
          .from('places')
          .update({
            name: trimmedName,
            visit_time: visitTime || null,
            memo: memo || null,
            day_id: selectedDayId,
            order_key: newKey,
          })
          .eq('id', place.id)

        if (updateError) throw updateError
      } else {
        const { error: updateError } = await supabase
          .from('places')
          .update({ name: trimmedName, visit_time: visitTime || null, memo: memo || null })
          .eq('id', place.id)

        if (updateError) throw updateError
      }
    } catch {
      // 실패하면 모달을 닫지 않는다 — 사용자가 입력한 내용이 사라지면 안 된다.
      setError(t('saveFailed'))
      setSaving(false)
      return
    }

    setSaving(false)
    onSave()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="fixed bottom-0 left-0 right-0 rounded-t-2xl bg-white p-6 transition-transform outline-none"
        style={{ transform: keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-4 text-base font-semibold text-gray-900">
          {t('title')}
        </h2>

        <div className="mb-4 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">
            {t('nameLabel')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={trimmedName.length === 0}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>

        {days && days.length > 1 && (
          <div className="mb-4 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500">
              {t('moveDate')}
            </label>
            <select
              value={selectedDayId}
              onChange={(e) => setSelectedDayId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 pl-3 pr-8 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            >
              {days.map((day, i) => (
                <option key={day.id} value={day.id}>
                  {`${tCommon('dayLabel', { n: i + 1 })} - ${formatDayDate(format, day.date)}`}
                  {day.id === place.day_id ? ` ${t('current')}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">
            {t('visitTime')}
          </label>
          <input
            type="time"
            value={visitTime}
            onChange={(e) => setVisitTime(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>

        <div className="mb-6 flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500">
            {t('memo')}
          </label>
          <textarea
            rows={3}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
          />
        </div>

        {error && (
          <p role="alert" className="mb-3 text-xs text-red-500">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={requestClose}
            disabled={saving}
            className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 disabled:opacity-50"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 rounded-lg bg-gray-900 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? t('submitting') : dayChanged ? t('submitMove') : t('submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
