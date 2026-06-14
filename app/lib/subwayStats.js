// 시간대·평일/주말별 노인 비중 분포에서 백분위(상위 %) 및 색상 계산.

export function hourShares(data, hour, daytype) {
  // 해당 시간대/요일구분에서 (역 -> 비중) 맵과 정렬된 비중 배열 반환
  const map = new Map();
  const arr = [];
  for (const [name, s] of Object.entries(data.stations)) {
    const v = s.share?.[daytype]?.[String(hour)];
    if (typeof v === "number") {
      map.set(name, v);
      arr.push(v);
    }
  }
  arr.sort((a, b) => a - b);
  return { map, sorted: arr };
}

// 값이 분포에서 차지하는 백분위(0~1, 클수록 비중 높음)
export function percentile(sorted, value) {
  if (!sorted.length) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

// 상위 몇 %인지 (비중이 높을수록 작은 값). 최소 1%로 표기.
export function topPercent(p) {
  return Math.max(1, Math.round((1 - p) * 100));
}

// 백분위 p(0~1) -> 파랑(하위)~빨강(상위). 평균 부근도 인지되도록 대비 곡선 적용.
export function colorForP(p) {
  const red = [199, 38, 30];
  const mid = [236, 236, 230];
  const blue = [25, 100, 205];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const t = Math.max(-1, Math.min(1, (p - 0.5) * 2));
  // |t|를 0.55제곱으로 키워 평균에서 조금만 벗어나도 빠르게 채도 상승
  const s = Math.sign(t) * Math.pow(Math.abs(t), 0.55);
  const rgb = s >= 0 ? mix(mid, red, s) : mix(mid, blue, -s);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
