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

// 백분위 p(0~1) -> 파랑(하위)~흰색~빨강(상위) 색상
export function colorForP(p) {
  const red = [210, 59, 47];
  const white = [240, 240, 240];
  const blue = [47, 111, 210];
  const mix = (a, b, t) =>
    a.map((v, i) => Math.round(v + (b[i] - v) * t));
  let rgb;
  if (p >= 0.5) rgb = mix(white, red, (p - 0.5) * 2);
  else rgb = mix(white, blue, (0.5 - p) * 2);
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
