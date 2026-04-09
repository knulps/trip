'use client'

import { useState, useEffect } from 'react'
import type { Place } from '@/types/supabase'
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

interface Props {
  dayId: string | null
  places: Place[]
  onRefresh: () => void
  onFocusPlace?: (place: Place) => void
}

interface SortableItemProps {
  place: Place
  index: number
  editMode: boolean
  onDelete: (id: string) => void
  onEdit: (place: Place) => void
  onFocus?: (place: Place) => void
}

function SortablePlaceItem({ place, index, editMode, onDelete, onEdit, onFocus }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: place.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 py-3"
    >
      {editMode && (
        <span
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab text-gray-300 active:cursor-grabbing dark:text-gray-600"
          aria-label="드래그 핸들"
        >
          ⠿
        </span>
      )}
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-bold text-white dark:bg-gray-100 dark:text-gray-900">
        {index + 1}
      </span>
      <div
        className="flex-1 min-w-0 cursor-pointer"
        onClick={() => !editMode && onEdit(place)}
      >
        <p className="text-sm font-medium truncate">{place.name}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
          {place.visit_time && <span className="mr-1">{place.visit_time.slice(0, 5)}</span>}
          {place.address}
        </p>
      </div>
      {!editMode && (
        <>
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
        </>
      )}
      {editMode && (
        <button
          onClick={() => onDelete(place.id)}
          className="shrink-0 text-gray-300 transition-colors hover:text-red-400 active:text-red-600 dark:text-gray-600 dark:hover:text-red-400"
          aria-label="장소 삭제"
        >
          ✕
        </button>
      )}
    </li>
  )
}

export default function PlaceList({ dayId, places, onRefresh, onFocusPlace }: Props) {
  const supabase = createClient()
  const [editMode, setEditMode] = useState(false)
  const [editingPlace, setEditingPlace] = useState<Place | null>(null)
  const [localPlaces, setLocalPlaces] = useState<Place[]>(places)

  // Sync local places when parent places change (outside edit mode)
  useEffect(() => {
    if (!editMode) setLocalPlaces(places)
  }, [places, editMode])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } })
  )

  async function deletePlace(id: string) {
    await supabase.from('places').delete().eq('id', id)
    onRefresh()
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = localPlaces.findIndex(p => p.id === active.id)
    const newIndex = localPlaces.findIndex(p => p.id === over.id)

    // Optimistic local reorder
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

  if (!dayId) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <p className="text-sm text-gray-400">날짜를 선택하거나 추가해주세요</p>
      </div>
    )
  }

  const displayPlaces = editMode ? localPlaces : places

  return (
    <>
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {displayPlaces.length}개 장소
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (editMode) setLocalPlaces(places)
                setEditMode(v => !v)
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors dark:border-gray-700 dark:text-gray-300"
            >
              {editMode ? '완료' : '✏️ 편집'}
            </button>
            {!editMode && (
              <Link
                href={`/trip/add?dayId=${dayId}`}
                className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white dark:bg-gray-100 dark:text-gray-900"
              >
                + 장소 추가
              </Link>
            )}
          </div>
        </div>

        {displayPlaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <p className="text-sm text-gray-400">아직 장소가 없어요</p>
          </div>
        ) : editMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={localPlaces.map(p => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="flex flex-col divide-y divide-gray-50 px-4 dark:divide-gray-800">
                {localPlaces.map((place, i) => (
                  <SortablePlaceItem
                    key={place.id}
                    place={place}
                    index={i}
                    editMode={editMode}
                    onDelete={deletePlace}
                    onEdit={setEditingPlace}
                    onFocus={onFocusPlace}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        ) : (
          <ol className="flex flex-col px-4">
            {places.map((place, i) => (
              <div key={place.id}>
                <SortablePlaceItem
                  place={place}
                  index={i}
                  editMode={false}
                  onDelete={deletePlace}
                  onEdit={setEditingPlace}
                  onFocus={onFocusPlace}
                />
                {i < places.length - 1 && (
                  <DistanceBadge from={place} to={places[i + 1]} />
                )}
              </div>
            ))}
          </ol>
        )}
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
