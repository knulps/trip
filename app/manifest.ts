import type { MetadataRoute } from 'next'
import { getTranslations } from 'next-intl/server'

// manifest.ts 는 route handler 라서 async 로 만들고 요청 시점 API(쿠키/헤더)를 읽을 수 있다.
// 다만 브라우저는 manifest 를 자격증명 없이(no-credentials) 받아가는 것이 기본이라
// NEXT_LOCALE 쿠키는 대체로 전달되지 않는다. 그래서 실제로는 i18n/request.ts 의
// Accept-Language 협상 결과가 이 값을 결정한다.
// 즉 "쿠키로 언어를 바꾼 뒤 홈 화면에 추가"하면 브라우저 언어 기준 이름이 붙을 수 있다.
// 이를 완전히 맞추려면 manifest link 에 crossorigin="use-credentials" 가 필요한데,
// Next 가 자동으로 넣는 <link rel="manifest"> 에는 그 속성을 지정할 수 없다.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('metadata')

  return {
    name: t('title'),
    short_name: t('shortName'),
    description: t('description'),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#111827',
    // orientation 은 지정하지 않는다.
    // 'portrait' 로 고정하면 설치된 앱에서 화면 회전이 막히는데, 지도를 가로로
    // 넓게 보려는 사용자에게는 그대로 불편이 된다. 기기 회전 설정을 따르게 둔다.
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      // TODO: maskable 전용 아이콘을 따로 만들 것.
      // 지금은 'any' 와 같은 /icon.svg 를 쓰고 있는데, 이 SVG 에는 safe zone
      // (가장자리 여백)이 없어서 Android 가 마스크를 씌우면 도형이 잘린다.
      // 바깥 20% 를 여백으로 남긴 별도 아이콘(권장 512x512 PNG)이 준비되면 교체한다.
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  }
}
