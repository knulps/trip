export default function TripLoading() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* 헤더 */}
      <header
        className="flex items-center gap-3 px-4 pb-2"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="h-8 w-8 rounded-full bg-gray-200" />
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="h-4 w-36 rounded bg-gray-200" />
          <div className="h-3 w-24 rounded bg-gray-100" />
        </div>
        <div className="h-8 w-8 rounded-full bg-gray-200" />
      </header>

      {/* 날짜 탭 */}
      <div className="flex items-center gap-2 px-4 pb-2">
        <div className="h-7 w-12 rounded-full bg-gray-100" />
        <div className="h-7 w-20 rounded-full bg-gray-200" />
        <div className="h-7 w-20 rounded-full bg-gray-100" />
        <div className="h-7 w-20 rounded-full bg-gray-100" />
      </div>

      {/* 지도 */}
      <div className="flex-none bg-gray-200" style={{ height: '35dvh' }} />

      {/* 장소 리스트 */}
      <div className="flex-1 overflow-hidden px-4 pt-3 flex flex-col gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-6 w-6 rounded-full bg-gray-200 shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <div className="h-3.5 w-32 rounded bg-gray-200" />
              <div className="h-2.5 w-48 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
