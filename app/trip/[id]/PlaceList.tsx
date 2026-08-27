'use client'

import { useState, useEffect, useCallback } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import type { Place, Day } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
import { formatDayDate } from '@/lib/format'
import Link from 'next/link'
import { generateKeyBetween } from 'fractional-indexing'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import EditPlaceModal from './EditPlaceModal'
import DistanceBadge from './DistanceBadge'

type DayWithPlaces = Day & { places: Place[] }

interface Props {
  days: DayWithPlaces[]
  editMode: boolean
  onRefresh: () => void
  onFocusPlace?: (place: Place) => void
  onSelectRoute?: (origin: { lat: number; lng: number }, destination: { lat: number; lng: number }, mode: string, fromPlaceId?: string, toPlaceId?: string) => void
  dayRefs: React.RefObject<globalThis.Map<string, HTMLDivElement>>
  activeRoutePlaceIds?: { from: string; to: string } | null
}

/* ── PlaceItem: non-edit mode ── */
// `children` 은 이 장소와 다음 장소 사이의 구분자(DistanceBadge)다.
// <ol> 의 직계 자식은 <li> 만 허용되므로 badge 를 앞 장소의 <li> 안에 넣는다.
// (badge 는 실제 버튼을 담고 있어 aria-hidden 으로 감추면 안 되고,
//  독립 <li> 로 두면 목록 항목 수가 장소 수와 어긋난다.)
function PlaceItem({
  place,
  index,
  onEdit,
  onFocus,
  isRouteOrigin,
  isRouteDest,
  children,
}: {
  place: Place
  index: number
  onEdit: (place: Place) => void
  onFocus?: (place: Place) => void
  isRouteOrigin?: boolean
  isRouteDest?: boolean
  children?: React.ReactNode
}) {
  const t = useTranslations('trip.placeList')

  return (
    <li>
      <div className={`flex items-center gap-3 py-3 transition-all ${
        isRouteOrigin ? 'border-l-4 border-green-500 pl-2 -ml-2' :
        isRouteDest ? 'border-l-4 border-red-500 pl-2 -ml-2' : ''
      }`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit(place)}>
          <p className="text-sm font-medium truncate">{place.name}</p>
          <p className="text-xs text-gray-400 truncate">
            {place.visit_time && <span className="mr-1">{place.visit_time.slice(0, 5)}</span>}
            {place.address}
          </p>
          {place.memo && (
            <p className="text-xs text-gray-400 truncate">{place.memo}</p>
          )}
        </div>
        <button
          onClick={() => onFocus?.(place)}
          className="shrink-0 text-gray-300 transition-colors hover:text-blue-400 active:text-blue-600"
          aria-label={t('viewOnMap')}
        >
          📍
        </button>
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.name + ' ' + place.address)}&travelmode=transit`}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-gray-300 transition-colors hover:text-green-400 active:text-green-600"
          aria-label={t('directions')}
        >
          ↗
        </a>
      </div>
      {children}
    </li>
  )
}

/* ── SortablePlaceItem: edit mode, inside DndContext ── */
function SortablePlaceItem({
  place,
  index,
  onDelete,
}: {
  place: Place
  index: number
  onDelete: (id: string) => void
}) {
  const t = useTranslations('trip.placeList')

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: place.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 py-3">
      <span
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab text-gray-300 active:cursor-grabbing"
        aria-label={t('dragHandle')}
        style={{ touchAction: 'none' }}
      >
        ⠿
      </span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{place.name}</p>
        <p className="text-xs text-gray-400 truncate">
          {place.visit_time && <span className="mr-1">{place.visit_time.slice(0, 5)}</span>}
          {place.address}
        </p>
      </div>
      <button
        onClick={() => onDelete(place.id)}
        className="shrink-0 text-gray-300 transition-colors hover:text-red-400 active:text-red-600"
        aria-label={t('deletePlace')}
      >
        ✕
      </button>
    </li>
  )
}

/* ── DraggableDayPlaces: one day's places wrapped in DndContext ── */
function DraggableDayPlaces({
  places,
  onRefresh,
}: {
  places: Place[]
  onRefresh: () => void
}) {
  const t = useTranslations('trip.placeList')
  const supabase = createClient()
  const [localPlaces, setLocalPlaces] = useState(places)

  useEffect(() => {
    setLocalPlaces(places)
  }, [places])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const deletePlace = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return
    // delete 는 RLS 에 막혀 한 행도 지우지 못해도 error 가 null 이라 지워진 행 수까지 봐야 한다.
    // 다른 탭에서 이 여행을 나간 뒤라면 places_all 정책에 막혀 0행이 되는데, 그대로 진행하면
    // 이어지는 갱신 조회도 전부 걸러져 화면만 비고 에러는 뜨지 않는다.
    // 사용자는 자기가 지웠다고 믿지만 실제 데이터는 그대로 남는다.
    const { data: deleted, error } = await supabase
      .from('places')
      .delete()
      .eq('id', id)
      .select('id')
    if (error || !deleted || deleted.length === 0) {
      window.alert(t('deleteFailed'))
      return
    }
    onRefresh()
  }, [supabase, onRefresh, t])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const previous = localPlaces
    const oldIndex = previous.findIndex(p => p.id === active.id)
    const newIndex = previous.findIndex(p => p.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(previous, oldIndex, newIndex)
    setLocalPlaces(reordered)

    // 새 order_key 의 경계 = 이동이 끝난 배열에서 옮겨진 항목의 앞/뒤 이웃.
    const before = reordered[newIndex - 1]?.order_key ?? null
    const after = reordered[newIndex + 1]?.order_key ?? null

    try {
      // 두 경계가 같거나 순서가 뒤집혀 있으면 generateKeyBetween 이 throw 한다.
      const newKey = generateKeyBetween(before, after)
      const { error } = await supabase
        .from('places')
        .update({ order_key: newKey })
        .eq('id', active.id as string)
      if (error) throw error
      onRefresh()
    } catch {
      setLocalPlaces(previous) // 낙관적 순서 되돌리기
      window.alert(t('reorderFailed'))
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={localPlaces.map(p => p.id)} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col divide-y divide-gray-50 px-4">
          {localPlaces.map((place, i) => (
            <SortablePlaceItem key={place.id} place={place} index={i} onDelete={deletePlace} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

/* ── Main PlaceList ── */
export default function PlaceList({ days, editMode, onRefresh, onFocusPlace, onSelectRoute, dayRefs, activeRoutePlaceIds }: Props) {
  const t = useTranslations('trip.placeList')
  const tCommon = useTranslations('common')
  const format = useFormatter()
  const [editingPlace, setEditingPlace] = useState<Place | null>(null)
  const supabase = createClient()

  const deleteAllPlaces = useCallback(async (dayId: string, dayNumber: number, count: number) => {
    if (!window.confirm(t('confirmDeleteAll', { day: dayNumber, count }))) return
    // 여기서도 지워진 행 수를 확인한다 (이유는 위 deletePlace 주석 참고).
    // 이 버튼은 그 날짜에 장소가 1건 이상 있을 때만 그려지므로 지울 대상이 없었을 리 없다.
    // 즉 0행은 지울 권한이 없었다는 뜻이라 실패로 본다.
    const { data: deleted, error } = await supabase
      .from('places')
      .delete()
      .eq('day_id', dayId)
      .select('id')
    if (error || !deleted || deleted.length === 0) {
      window.alert(t('deleteAllFailed'))
      return
    }
    onRefresh()
  }, [supabase, onRefresh, t])

  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <p className="text-sm text-gray-400">{t('selectDay')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col">
        {days.map((day, dayIndex) => {
          const dateLabel = formatDayDate(format, day.date)

          return (
            <div
              key={day.id}
              data-day-id={day.id}
              ref={(el) => {
                if (!el) return
                // React 19 의 ref cleanup — Day 가 삭제되면 Map 에서도 지워야
                // TripView 의 scroll-spy 가 detach 된 엘리먼트를 계속 보지 않는다.
                const refs = dayRefs.current
                refs.set(day.id, el)
                return () => {
                  refs.delete(day.id)
                }
              }}
            >
              {/* Day Header */}
              <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm px-4 py-2 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">
                    {tCommon('dayLabel', { n: dayIndex + 1 })}{' '}
                    <span className="text-xs font-normal text-gray-400">{dateLabel}</span>
                    <span className="ml-1.5 text-xs font-normal text-gray-400">
                      · {t('placeCount', { count: day.places.length })}
                    </span>
                  </span>
                  {editMode && day.places.length > 0 && (
                    <button
                      onClick={() => deleteAllPlaces(day.id, dayIndex + 1, day.places.length)}
                      className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
                    >
                      {t('deleteAll')}
                    </button>
                  )}
                  {!editMode && (
                    <Link
                      href={`/trip/add?dayId=${day.id}`}
                      className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white"
                    >
                      {t('addPlace')}
                    </Link>
                  )}
                </div>
              </div>

              {/* Places */}
              {day.places.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
                  <p className="text-sm text-gray-400">{t('empty')}</p>
                </div>
              ) : editMode ? (
                <DraggableDayPlaces places={day.places} onRefresh={onRefresh} />
              ) : (
                <ol className="flex flex-col px-4">
                  {day.places.map((place, i) => (
                    <PlaceItem
                      key={place.id}
                      place={place}
                      index={i}
                      onEdit={setEditingPlace}
                      onFocus={onFocusPlace}
                      isRouteOrigin={activeRoutePlaceIds?.from === place.id}
                      isRouteDest={activeRoutePlaceIds?.to === place.id}
                    >
                      {i < day.places.length - 1 && (
                        <DistanceBadge from={place} to={day.places[i + 1]} onSelectRoute={onSelectRoute} />
                      )}
                    </PlaceItem>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>

      {editingPlace && (
        <EditPlaceModal
          place={editingPlace}
          days={days}
          onClose={() => setEditingPlace(null)}
          onSave={onRefresh}
        />
      )}
    </>
  )
}
