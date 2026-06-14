import { Noto_Sans_KR, Noto_Serif_KR } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700", "900"],
});

const notoSerif = Noto_Serif_KR({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
});

export const metadata = {
  title: "“청년 눈치 보여 출근길은 피해요”… 죄인이 된 지하철의 어르신들",
  description:
    "데이터와 현장 취재로 들여다본 노인 무임승차 논쟁 — 청년과 노인 사이, 통계가 말하는 진실.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className={`${notoSans.variable} ${notoSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
