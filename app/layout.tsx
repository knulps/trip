import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import Script from 'next/script'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale, getTranslations } from 'next-intl/server'
import './globals.css'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

// 정적 metadata 로 두면 한국어 사용자도 영어 탭 제목/공유 미리보기를 보게 되므로
// 요청 로케일을 읽을 수 있는 generateMetadata 로 만든다.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata')

  return {
    title: t('title'),
    description: t('description'),
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      // 홈 화면 아이콘 이름은 길면 잘리므로 짧은 이름을 쓴다
      title: t('shortName'),
    },
  }
}

// maximumScale/userScalable 로 확대를 막지 않는다.
// 확대 차단은 WCAG 1.4.4 위반이고, 지도와 작은 글씨를 보는 앱에서는 특히 문제가 된다.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#111827',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html lang={locale} className={`${geist.variable} h-full antialiased`}>
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className="h-full bg-white text-gray-900" style={{ colorScheme: 'light' }}>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
        {/*
          service worker 등록.
          - next/script 의 afterInteractive 로 hydration 이후에 실행한다.
            PWA 설치 가능 여부만 결정하면 되므로 첫 화면을 막을 이유가 없다.
          - 개발 모드에서는 등록하지 않는다. 등록해두면 HMR 이 방해받는다.
            NODE_ENV 비교는 빌드 시점에 정해지므로 dev 빌드에는 이 script 자체가 없다.
          - register() 실패(예: private 모드, HTTPS 아님)를 catch 해서
            처리되지 않은 rejection 이 뜨지 않게 한다.
        */}
        {process.env.NODE_ENV === 'production' && (
          <Script id="register-sw" strategy="afterInteractive">
            {`if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(err){console.error('service worker registration failed:',err)})}`}
          </Script>
        )}
      </body>
    </html>
  )
}
