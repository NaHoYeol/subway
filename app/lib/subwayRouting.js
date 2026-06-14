// 지하철 노선 그래프 + 경로 탐색(최대 3개) — subway.json 기반.
// 인접: 노선 내 연속역(거리<3.5km), 환승: 좌표 근접(<0.35km) 다른 역.

function km(a, b) {
  return Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88);
}

export function buildGraph(data) {
  const S = data.stations;
  const adj = new Map(); // name -> Map(to -> line)
  const add = (a, b, line) => {
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.get(a).has(b)) adj.get(a).set(b, line);
  };
  for (const [line, seq] of Object.entries(data.network)) {
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i];
      const b = seq[i + 1];
      if (S[a] && S[b] && km(S[a], S[b]) < 3.5) {
        add(a, b, line);
        add(b, a, line);
      }
    }
  }
  // 좌표 근접 환승(역명이 달라 노선 시퀀스로 안 이어지는 경우 보강)
  const names = Object.keys(S);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i];
      const b = names[j];
      if (adj.get(a)?.has(b)) continue;
      if (km(S[a], S[b]) < 0.35) {
        add(a, b, "환승");
        add(b, a, "환승");
      }
    }
  }
  return adj;
}

// 사용자가 고른 경유지(승차-환승…-하차)를 한 노선씩 이어붙임.
// 연속한 두 역이 같은 노선으로 직접 연결되지 않으면 환승역 누락 → error.
export function stitchRoute(data, waypoints) {
  const NET = data.network;
  const legs = [];
  const full = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (a === b) continue;
    // a,b를 모두 포함하는 노선 중 구간이 가장 짧은 것 선택
    let best = null;
    for (const [line, seq] of Object.entries(NET)) {
      const ia = seq.indexOf(a);
      const ib = seq.indexOf(b);
      if (ia >= 0 && ib >= 0) {
        const span = Math.abs(ia - ib);
        if (!best || span < best.span) {
          const slice =
            ia < ib ? seq.slice(ia, ib + 1) : seq.slice(ib, ia + 1).reverse();
          best = { line, slice, span };
        }
      }
    }
    if (!best) return { error: "transfer" };
    legs.push({
      line: best.line,
      board: a,
      alight: b,
      stops: best.slice.length - 1,
    });
    if (i === 0) full.push(...best.slice);
    else full.push(...best.slice.slice(1));
  }
  if (full.length < 2) return { error: "empty" };
  const transferStations = waypoints.slice(1, -1);
  return {
    stations: full,
    legs,
    transferStations,
    transfers: transferStations.length,
    stops: full.length,
  };
}

function dijkstra(adj, src, dst, blocked) {
  // 홉(역 수) 최소 경로. blocked: Set("a|b")
  const dist = new Map([[src, 0]]);
  const prev = new Map();
  const visited = new Set();
  const pq = [[0, src]];
  while (pq.length) {
    pq.sort((x, y) => x[0] - y[0]);
    const [d, u] = pq.shift();
    if (visited.has(u)) continue;
    visited.add(u);
    if (u === dst) break;
    const nb = adj.get(u);
    if (!nb) continue;
    for (const v of nb.keys()) {
      if (visited.has(v)) continue;
      if (blocked && blocked.has(u + "|" + v)) continue;
      const nd = d + 1;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        pq.push([nd, v]);
      }
    }
  }
  if (!prev.has(dst) && src !== dst) return null;
  const path = [dst];
  let cur = dst;
  while (cur !== src) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    path.unshift(cur);
  }
  return path;
}

// 경로에 노선/환승 정보 부여 + 구간(leg) 분해
function annotate(adj, path) {
  // 각 구간의 노선 (환승 보조간선은 직전 노선을 잇는 것으로 처리)
  const segLines = [];
  let prevLine = null;
  for (let i = 0; i < path.length - 1; i++) {
    let line = adj.get(path[i])?.get(path[i + 1]) || prevLine || "";
    if (line === "환승") line = prevLine || line;
    segLines.push(line);
    prevLine = line;
  }
  // 동일 노선 구간을 묶어 leg 생성
  const legs = [];
  let boardIdx = 0;
  for (let i = 1; i <= segLines.length; i++) {
    if (i === segLines.length || segLines[i] !== segLines[boardIdx]) {
      legs.push({
        line: segLines[boardIdx],
        board: path[boardIdx],
        alight: path[i],
        stops: i - boardIdx,
      });
      boardIdx = i;
    }
  }
  const transferStations = legs.slice(1).map((l) => l.board);
  return { segLines, legs, transferStations, transfers: transferStations.length };
}

// 최대 k개의 서로 다른 추천 경로
export function findRoutes(adj, src, dst, k = 3) {
  if (src === dst) return [];
  const best = dijkstra(adj, src, dst, null);
  if (!best) return [];
  const seen = new Set([best.join(">")]);
  const routes = [best];
  // 최단 경로의 각 간선을 막아 대안 경로 생성
  for (let i = 0; i < best.length - 1 && routes.length < k * 3; i++) {
    const blocked = new Set([
      best[i] + "|" + best[i + 1],
      best[i + 1] + "|" + best[i],
    ]);
    const alt = dijkstra(adj, src, dst, blocked);
    if (alt) {
      const key = alt.join(">");
      if (!seen.has(key)) {
        seen.add(key);
        routes.push(alt);
      }
    }
  }
  routes.sort((a, b) => a.length - b.length);
  return routes.slice(0, k).map((path) => {
    const { segLines, legs, transferStations, transfers } = annotate(adj, path);
    return {
      stations: path,
      segLines,
      legs,
      transferStations,
      transfers,
      stops: path.length,
    };
  });
}
