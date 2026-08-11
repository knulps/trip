export default function ImportLoading() {
  return (
    <div className="flex flex-col h-full animate-pulse">
      {/* 헤더 */}
      <header
        className="flex items-center gap-3 px-4 pb-4"
        style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <div className="h-5 w-3 rounded bg-gray-200" />
        <div className="h-4 w-24 rounded bg-gray-200" />
      </header>

      <div className="flex flex-col gap-4 px-4 flex-1 overflow-hidden pb-4">
        {/* 파일 선택 */}
        <div className="flex flex-col gap-2">
          <div className="h-2.5 w-20 rounded bg-gray-100" />
          <div className="h-7 w-40 rounded-lg bg-gray-200" />
        </div>

        {/* Day 선택 + 전체 선택 */}
        <div className="flex items-center gap-2">
          <div className="h-9 flex-1 rounded-lg bg-gray-100" />
          <div className="h-9 w-20 rounded-lg bg-gray-100" />
        </div>

        {/* 장소 리스트 */}
        <div className="flex flex-col gap-4 pt-1">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-gray-200 shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-3.5 w-40 rounded bg-gray-200" />
                <div className="h-2.5 w-28 rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
