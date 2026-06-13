"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cloud from "d3-cloud";
import data from "../_data/wordcloud.json";
import styles from "./WordCloud.module.css";

// 빨강~회색 톤 팔레트 (기사 액센트와 통일)
const PALETTE = [
  "#c0392b",
  "#922b21",
  "#d35400",
  "#7b4b3a",
  "#566573",
  "#34495e",
  "#1f2d3a",
];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

export default function WordCloud() {
  const containerRef = useRef(null);
  const [width, setWidth] = useState(720);
  const [laidOut, setLaidOut] = useState([]);
  const [hover, setHover] = useState(null);

  const height = Math.round(width * 0.62);

  // 컨테이너 너비 추적 (반응형)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 가중치 -> 폰트 크기 매핑 (sqrt 스케일로 과한 격차 완화)
  const sized = useMemo(() => {
    const weights = data.words.map((w) => w.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const minF = Math.max(12, width / 48);
    const maxF = Math.max(40, width / 9);
    const norm = (v) =>
      (Math.sqrt(v) - Math.sqrt(min)) / (Math.sqrt(max) - Math.sqrt(min) || 1);
    return data.words.map((w, i) => ({
      ...w,
      index: i,
      size: Math.round(minF + norm(w.weight) * (maxF - minF)),
    }));
  }, [width]);

  // d3-cloud 레이아웃 계산 (브라우저에서만)
  useEffect(() => {
    let cancelled = false;
    const layout = cloud()
      .size([width, height])
      .words(sized.map((w) => ({ ...w })))
      .padding(width < 480 ? 1 : 3)
      .rotate((d) => (d.index % 7 === 0 ? 90 : 0))
      .font('"Noto Sans KR", sans-serif')
      .fontSize((d) => d.size)
      .spiral("archimedean")
      .random(() => 0.5) // 결정적 배치 (리렌더 시 흔들림 방지)
      .on("end", (out) => {
        if (!cancelled) setLaidOut(out);
      });
    layout.start();
    return () => {
      cancelled = true;
      layout.stop();
    };
  }, [sized, width, height]);

  return (
    <figure className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.badge}>유튜브 댓글 분석</span>
        <p className={styles.headText}>
          “{data.meta.videoTitle}” 영상의 댓글{" "}
          {data.meta.commentCount.toLocaleString()}개에서 많이 등장한 단어
        </p>
      </div>

      <div ref={containerRef} className={styles.canvas} style={{ height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="유튜브 댓글 워드클라우드"
        >
          <g transform={`translate(${width / 2}, ${height / 2})`}>
            {laidOut.map((w) => (
              <text
                key={w.text}
                className={styles.word}
                textAnchor="middle"
                transform={`translate(${w.x}, ${w.y}) rotate(${w.rotate})`}
                style={{
                  fontSize: w.size,
                  fill: colorFor(w.index),
                  opacity: hover && hover !== w.text ? 0.25 : 1,
                }}
                onMouseEnter={() => setHover(w.text)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(w.text)}
                onBlur={() => setHover(null)}
                tabIndex={0}
              >
                {w.text}
              </text>
            ))}
          </g>
        </svg>

        {hover &&
          (() => {
            const w = data.words.find((x) => x.text === hover);
            if (!w) return null;
            return (
              <div className={styles.tooltip}>
                <strong>{w.text}</strong>
                <span>
                  언급 {w.count.toLocaleString()}회 · 평균 좋아요 {w.avgLikes}
                </span>
              </div>
            );
          })()}
      </div>

      <figcaption className={styles.caption}>
        단어 크기 = 댓글에서 언급된 빈도 (공감을 많이 받은 댓글일수록 약간 더 크게
        반영). 단어에 마우스를 올리면 상세 수치를 볼 수 있다. (자료: 유튜브 ‘
        {data.meta.channel}’ 영상 댓글 {data.meta.commentCount.toLocaleString()}개
        분석)
      </figcaption>
    </figure>
  );
}
