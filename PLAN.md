# 구현 계획

> 기준 날짜: 2026-04-10

---

## 아키텍처 결정

### 파일 구조 변경
```
app/trip/[id]/
├── page.tsx              (변경 없음)
├── TripView.tsx          (Day 탭, 스크롤 전환, Day 삭제, Realtime days 구독 추가)
├── PlaceList.tsx         (길찾기 버튼, 순서 변경, 수정 모달 연결, 거리 배지 추가)
├── EditPlaceModal.tsx    (신규: 장소 수정 모달)
└── DistanceBadge.tsx     (신규: 거리·시간 배지)
```

### Distance 호출 방식
- **Routes API** (`computeRouteMatrix`) 사용 — Distance Matrix API는 2025년 3월 Deprecated
- 서버에서 호출: `app/api/distance/route.ts` (API 키를 `GOOGLE_MAPS_SERVER_KEY` 환경변수로 서버에서만 사용, 클라이언트 노출 방지)
- 요청: `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`
- **비용**: 1 element = $0.005. 장소 5개 Day면 4쌍 = $0.02. 소규모 개인 앱 수준에서 실질 비용 미미

### Realtime 구독 확장
- 현재: `places` 테이블만 구독
- 변경: `places` + `days` 테이블 모두 구독 → `refreshDays()` 호출

---

## Phase 1: 쉬운 것 먼저 (UI only)

### Step 1-1: Day 탭 날짜·요일 표시 (TripView.tsx)
- `day.date` (YYYY-MM-DD) → `new Date(day.date + 'T00:00:00')` 로컬 파싱
- 요일: `['일','월','화','수','목','금','토'][date.getDay()]`
- 탭 버튼 2줄 레이아웃: 윗줄 "Day N", 아랫줄 "4/15 화" (text-[10px], 불투명도 낮춤)

### Step 1-2: Day 삭제 (TripView.tsx)
- 탭 버튼 오른쪽에 ✕ 버튼 추가 (항상 표시, 탭과 분리)
- 삭제 순서 (CASCADE 미보장으로 코드에서 직접 처리):
  1. `places` WHERE `day_id = id` 전체 삭제
  2. `days` WHERE `id = id` 삭제
- 장소 있을 경우 `window.confirm` 또는 인라인 확인
- 삭제 후 `index - 1` Day로 포커스 (없으면 index 0)
- 삭제 후 `refreshDays()` 호출

### Step 1-3: 구글 길찾기 버튼 (PlaceList.tsx)
- 장소 행 오른쪽에 ↗ 아이콘 버튼 추가 (삭제 ✕ 버튼 옆)
- URL: `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}&travelmode=transit`
- `target="_blank"` + `rel="noopener noreferrer"`
- 편집 모드 ON 시 숨김

---

## Phase 2: 중간 난이도

### Step 2-1: 일정 수정 모달 (EditPlaceModal.tsx 신규)
- `PlaceList`에서 행 텍스트 영역 탭 → `EditPlaceModal` 열기
- 지도 포커스는 새 지도 핀 아이콘 버튼(🗺)으로 이동 (기존 행 전체 클릭 → 버튼 클릭)
- 모달 필드: 방문 시간(`time` input), 장소 이름(`text` input)
- 저장: `supabase.from('places').update(...)` → `onRefresh()`
- 편집 모드 ON 시 수정 모달 진입 불가

### Step 2-2: 장소 순서 변경 (PlaceList.tsx)
- 패키지 추가: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- 헤더에 "편집" 토글 버튼 추가
- 편집 모드 ON:
  - `DndContext` + `SortableContext` 로 리스트 감싸기
  - `SortablePlaceItem` 컴포넌트 분리
  - `useSortable` 훅으로 드래그 핸들(⠿) 제공
  - `onDragEnd` 콜백: `generateKeyBetween(prevKey, nextKey)` → Supabase UPDATE
  - 길찾기·삭제·수정 버튼 숨김
- 편집 모드 OFF: 일반 UI 복원

### Step 2-3: 스크롤로 일자 넘기기 (TripView.tsx)
- 장소 리스트 div에 `onScroll` 핸들러
- 감지 조건:
  ```
  const canScroll = scrollHeight > clientHeight
  if (!canScroll) return  // 스크롤 불가 상태에서는 무시
  if (scrollTop === 0 && direction === 'up') → 이전 Day
  if (scrollTop + clientHeight >= scrollHeight - 1 && direction === 'down') → 다음 Day
  ```
- 방향 감지: `useRef`로 이전 `scrollTop` 저장
- 전환 후 300ms 쿨다운 (`useRef`로 `lastTransitionTime` 기록)
- 전환 애니메이션: CSS `opacity` transition (fade)

---

## Phase 3: 높은 난이도

### Step 3-1: 장소 간 거리·소요시간 (DistanceBadge.tsx 신규)
- `app/api/distance/route.ts` 신규 생성 — 서버에서 Routes API 호출
  - `POST /api/distance` body: `{ origin: {lat,lng}, destination: {lat,lng}, mode: 'TRANSIT'|'DRIVE'|'WALK' }`
  - Routes API: `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`
  - 헤더: `X-Goog-Api-Key`, `X-Goog-FieldMask: originIndex,destinationIndex,duration,distanceMeters,status`
  - mode 순서: TRANSIT → DRIVE → WALK 순으로 fallback
- 클라이언트(`DistanceBadge.tsx`): `/api/distance` fetch
- 응답 캐싱: `useRef<Map<string, DistanceResult>>`로 세션 내 재요청 방지
- 렌더링: 두 장소 사이에 "🚌 12분 · 1.2km" 형태 배지
- 에러 시 조용히 숨김 (기능 선택적)

---

## 패키지 추가 필요

| 패키지 | 용도 |
|--------|------|
| `@dnd-kit/core` | 드래그 앤 드롭 컨텍스트 |
| `@dnd-kit/sortable` | 정렬 가능한 리스트 |
| `@dnd-kit/utilities` | CSS transform 유틸리티 |

---

## 작업 순서 요약

1. [x] 요구사항 문서 작성 + 검토 반영 (REQUIREMENTS.md)
2. [x] 구현 계획 작성 + 검토 반영 (PLAN.md)
3. [x] **Phase 1**: Day 날짜·요일 탭 + Day 삭제 + 길찾기 버튼
4. [x] **Phase 2**: 일정 수정 모달 + 장소 순서 변경 + 스크롤 일자 전환
5. [x] **Phase 3**: 거리·소요시간 표시 (API 키 등록 후 동작)
