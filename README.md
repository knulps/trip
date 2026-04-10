# 여행 일정

지인들과 실시간으로 함께 만드는 여행 일정 관리 앱.

## 기술 스택

- Next.js 16 / React 19 / TypeScript
- Tailwind CSS v4
- Supabase (PostgreSQL, Auth, Realtime)
- Google Maps API (Maps, Places, Routes)
- dnd-kit (드래그 앤 드롭)
- PWA (홈화면 설치, standalone 모드)

## 주요 기능

1. Google OAuth 로그인
2. 여행 생성/관리 (시작일~종료일)
3. 초대 링크로 멤버 추가
4. Day별 장소 관리 (추가/수정/삭제)
5. Google Maps 지도에 장소 마커 + 폴리라인 표시
6. 장소 드래그 앤 드롭 순서 변경 (편집 모드 토글)
7. 장소 수정 모달 (이름, 방문시간)
8. 구글 길찾기 바로 연동
9. Day별 날짜/요일 표시
10. Day 삭제
11. 스크롤로 일자 전환
12. 장소간 거리/소요시간 표시 (Routes API)
13. Supabase Realtime 실시간 동기화
14. 다크모드 지원
15. PWA (홈화면 설치, 주소창 없이 사용)

## 환경 변수

`.env.local` 파일에 아래 값을 설정한다.

| 변수명 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Maps API Key (Maps, Places) |
| `GOOGLE_MAPS_SERVER_KEY` | Google Routes API Key (서버용, 거리 배지, 선택) |

## 데이터베이스

Supabase PostgreSQL을 사용하며, RLS 정책으로 멤버만 접근 가능하다.

- **trips** -- 여행 정보
- **days** -- 여행 일자
- **places** -- 장소
- **trip_members** -- 멤버

## 스크립트

```bash
npm run dev    # 개발 서버
npm run build  # 빌드
npm run start  # 프로덕션 서버
```

## 디렉토리 구조

```
app/
  layout.tsx, page.tsx, manifest.ts
  login/page.tsx
  auth/callback/route.ts
  trip/
    [id]/page.tsx, TripView.tsx, PlaceList.tsx, EditPlaceModal.tsx, DistanceBadge.tsx
    new/page.tsx
    add/page.tsx, AddPlaceView.tsx
  invite/[token]/route.ts
  api/distance/route.ts
lib/supabase/client.ts, server.ts
types/supabase.ts
public/icon.svg, sw.js
```
