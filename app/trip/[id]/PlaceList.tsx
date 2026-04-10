'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Place, Day } from '@/types/supabase'
import { createClient } from '@/lib/supabase/client'
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
  onRefresh: () => void
  onFocusPlace?: (place: Place) => void
  dayRefs: React.RefObject<Map<string, HTMLDivElement>>
}

/* ── PlaceItem: non-edit mode, no dnd-kit hooks ── */
function PlaceItem({
  place,
  index,
  onEdit,
  onFocus,
}: {
  place: Place
  index: number
  onEdit: (place: Place) => void
  onFocus?: (place: Place) => void
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white dark:bg-gray-100 dark:text-gray-900">
        {index + 1}
      </span>
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => onEdit(place)}
      >
        <p className="text-sm font-medium truncate">{place.name}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {place.visit_time && <span className="mr-1">{place.visit_time.slice(0, 5)}</span>}
          {place.address}
        </p>
      </div>
      <button
        onClick={() => onFocus?.(place)}
        className="shrink-0 text-gray-300 transition-colors hover:text-blue-400 active:text-blue-600 dark:text-gray-600 dark:hover:text-blue-400"
        aria-label="지도에서 보기"
      >
        📍
      </button>
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}&travelmode=transit`}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-gray-300 transition-colors hover:text-green-400 active:text-green-600 dark:text-gray-600 dark:hover:text-green-400"
        aria-label="길찾기"
      >
        ↗
      </a>
    </li>
  )
}

/* ── SortablePlaceItem: edit mode only, inside DndContext ── */
function SortablePlaceItem({
  place,
  index,
  onDelete,
  onEdit,
}: {
  place: Place
  index: number
  onDelete: (id: string) => void
  onEdit: (place: Place) => void
}) {
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
        className="shrink-0 cursor-grab text-gray-300 active:cursor-grabbing dark:text-gray-600"
        aria-label="드래그 핸들"
      >
        ⠿
      </span>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white dark:bg-gray-100 dark:text-gray-900">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onEdit(place)}>
        <p className="text-sm font-medium truncate">{place.name}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {place.visit_time && <span className="mr-1">{place.visit_time.slice(0, 5)}</span>}
          {place.address}
        </p>
      </div>
      <button
        onClick={() => onDelete(place.id)}
        className="shrink-0 text-gray-300 transition-colors hover:text-red-400 active:text-red-600 dark:text-gray-600 dark:hover:text-red-400"
        aria-label="장소 삭제"
      >
        ✕
      </button>
    </li>
  )
}

/* ── EditableDaySection: wraps a day's places in DndContext ── */
function EditableDaySection({
  places,
  onRefresh,
  onDone,
}: {
  places: Place[]
  onRefresh: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const [localPlaces, setLocalPlaces] = useState(places)
  const [editingPlace, setEditingPlace] = useState<Place | null>(null)

  useEffect(() => {
    setLocalPlaces(places)
  }, [places])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const deletePlace = useCallback(async (id: string) => {
    await supabase.from('places').delete().eq('id', id)
    onRefresh()
  }, [supabase, onRefresh])

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = localPlaces.findIndex(p => p.id === active.id)
    const newIndex = localPlaces.findIndex(p => p.id === over.id)

    const reordered = arrayMove(localPlaces, oldIndex, newIndex)
    setLocalPlaces(reordered)

    const newKey = generateKeyBetween(
      oldIndex > newIndex
        ? (newIndex > 0 ? localPlaces[newIndex - 1].order_key : null)
        : localPlaces[newIndex].order_key,
      oldIndex > newIndex
        ? localPlaces[newIndex].order_key
        : (newIndex < localPlaces.length - 1 ? localPlaces[newIndex + 1]?.order_key ?? null : null)
    )

    await supabase.from('places').update({ order_key: newKey }).eq('id', active.id as string)
    onRefresh()
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={localPlaces.map(p => p.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col divide-y divide-gray-50 px-4 dark:divide-gray-800">
            {localPlaces.map((place, i) => (
              <SortablePlaceItem
                key={place.id}
                place={place}
                index={i}
                onDelete={deletePlace}
                onEdit={setEditingPlace}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {/* Done button at the bottom of the editable section */}
      <div className="flex justify-end px-4 py-2">
        <button
          onClick={() => { onDone() }}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors dark:border-gray-700 dark:text-gray-300"
        >
          완료
        </button>
      </div>

      {editingPlace && (
        <EditPlaceModal
          place={editingPlace}
          onClose={() => setEditingPlace(null)}
          onSave={onRefresh}
        />
      )}
    </>
  )
}

/* ── Main PlaceList ── */
export default function PlaceList({ days, onRefresh, onFocusPlace, dayRefs }: Props) {
  const [editingDayId, setEditingDayId] = useState<string | null>(null)
  const [editingPlace, setEditingPlace] = useState<Place | null>(null)

  if (days.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <p className="text-sm text-gray-400">날짜를 선택하거나 추가해주세요</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col">
        {days.map((day, dayIndex) => {
          const isEditing = editingDayId === day.id
          const date = new Date(day.date + 'T00:00:00')
          const dayOfWeek = ['일','월','화','수','목','금','토'][date.getDay()]
          const dateLabel = `${date.getMonth() + 1}/${date.getDate()} ${dayOfWeek}`

          return (
            <div
              key={day.id}
              data-day-id={day.id}
              ref={(el) => {
                if (el) dayRefs.current.set(day.id, el)
              }}
            >
              {/* Day Header */}
              <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm px-4 py-2 border-b border-gray-100 dark:bg-gray-950/90 dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Day {dayIndex + 1}{' '}
                    <span className="text-xs font-normal text-gray-400">{dateLabel}</span>
                    <span className="ml-1.5 text-xs font-normal text-gray-400">
                      · {day.places.length}개 장소
                    </span>
                  </span>
                  <div className="flex items-center gap-2">
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => setEditingDayId(day.id)}
                          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors dark:border-gray-700 dark:text-gray-300"
                        >
                          ✏️ 편집
                        </button>
                        <Link
                          href={`/trip/add?dayId=${day.id}`}
                          className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
                        >
                          + 장소 추가
                        </Link>
                      </>
                    )}
                    {isEditing && (
                      <button
                        onClick={() => setEditingDayId(null)}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors dark:border-gray-700 dark:text-gray-300"
                      >
                        완료
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Places */}
              {day.places.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
                  <p className="text-sm text-gray-400">아직 장소가 없어요</p>
                </div>
              ) : isEditing ? (
                <EditableDaySection
                  places={day.places}
                  onRefresh={onRefresh}
                  onDone={() => setEditingDayId(null)}
                />
              ) : (
                <ol className="flex flex-col px-4">
                  {day.places.map((place, i) => (
                    <div key={place.id}>
                      <PlaceItem
                        place={place}
                        index={i}
                        onEdit={setEditingPlace}
                        onFocus={onFocusPlace}
                      />
                      {i < day.places.length - 1 && (
                        <DistanceBadge from={place} to={day.places[i + 1]} />
                      )}
                    </div>
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
          onClose={() => setEditingPlace(null)}
          onSave={onRefresh}
        />
      )}
    </>
  )
}
