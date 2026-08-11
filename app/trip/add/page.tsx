import { Suspense } from 'react'
import AddPlaceView from './AddPlaceView'

// AddPlaceView 는 useSearchParams() 로 dayId 를 읽는다.
// Next 16 에서는 prerender 중 useSearchParams 를 쓰는 클라이언트 트리를
// <Suspense> 로 감싸야 하며(그렇지 않으면 production build 실패),
// 이 경계 덕분에 헤더/폼 골격은 정적으로 프리렌더된다.
// 예전처럼 export const dynamic = 'force-dynamic' 로 전체 라우트를
// 동적 렌더링시킬 필요는 없다 — 이 페이지는 서버에서 요청 정보를 쓰지 않는다.
function AddPlaceFallback() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      <header
        className="flex items-center gap-3 px-4 pb-4"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="h-5 w-5 rounded-full bg-gray-200" />
        <div className="h-4 w-24 rounded bg-gray-200" />
      </header>

      <div className="flex flex-col gap-4 px-4">
        <div className="h-11 w-full rounded-xl bg-gray-100" />
        <div className="flex flex-col gap-1">
          <div className="h-3 w-24 rounded bg-gray-100" />
          <div className="h-11 w-full rounded-xl bg-gray-100" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-3 w-16 rounded bg-gray-100" />
          <div className="h-20 w-full rounded-xl bg-gray-100" />
        </div>
        <div className="h-11 w-full rounded-xl bg-gray-200" />
      </div>
    </div>
  )
}

export default function AddPlacePage() {
  return (
    <Suspense fallback={<AddPlaceFallback />}>
      <AddPlaceView />
    </Suspense>
  )
}
